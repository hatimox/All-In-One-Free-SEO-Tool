/**
 * DataForSEO service layer: the API other features call.
 *
 * Every paid path is: visibility check -> cache lookup -> (guardPaid) ->
 * reserve budget -> call -> settle/release -> cache put -> request row.
 * Cache hits are free, never need a paid permission, and are recorded as
 * zero-cost ledger rows so "money saved" can be shown.
 *
 * `cacheOnly: true` never spends and never needs credentials (viewers, MCP
 * default). Backlink calls refuse unless `dataforseo.backlinks_enabled`.
 *
 * Standard-queue volume lookups return `{status:"pending", requestId}`;
 * `pollPendingRequests()` (call it from the scheduler or on page load)
 * collects them, and `getRequest()` reads the outcome.
 */
import { and, eq } from "drizzle-orm";
import { competitors as competitorsTable } from "@/db/schema";
import { db, sqlite } from "@/db/client";
import { extDfsRequests } from "../db/schema";
import { guardPaid, guardRead } from "../access/paid-guard";
import { getMcpContext, mcpSeesAll } from "../mcp/context";
import { visibleClientIdsForAction } from "../access/record-scope";
import { checkAlerts, raiseCapAlert } from "./alerts";
import { attachTask, BudgetError, recordCacheHit, release, reserve, settle, type Reservation, type ReserveInput } from "./budget";
import {
  cacheKeyFor,
  getCachedMetrics,
  getCachedResponse,
  normalizeKeywords,
  putCachedResponse,
  putMetrics,
  type CachedMetric,
  type MetricRow,
  type TtlKind,
} from "./cache";
import { costToMicros, DataForSeoError, isAuthOrFundsError } from "./client";
import { getSettings, isConfigured } from "./config";
import * as backlinksApi from "./endpoints/backlinks";
import * as labsApi from "./endpoints/labs";
import * as volumeApi from "./endpoints/volume";
import { clientDomain, marketForClient } from "./market";
import {
  DEFAULT_ROW_LIMIT,
  estimateMicros,
  tasksForKeywords,
  type EndpointId,
  type Mode,
} from "./pricing";

export { BudgetError } from "./budget";

type Kind = (typeof extDfsRequests.$inferSelect)["kind"];

export type MarketOverride = { location_code?: number; language_code?: string };

type CommonOpts = MarketOverride & {
  clientId: number;
  /** Never spend; return cached data only. */
  cacheOnly?: boolean;
};

async function resolveMarket(clientId: number, o: MarketOverride) {
  if (o.location_code && o.language_code) {
    return { locationCode: o.location_code, languageCode: o.language_code };
  }
  const m = await marketForClient(clientId);
  if (!m) {
    throw new Error(
      "This client's country has no known DataForSEO location. Set a supported country on the client or pass location_code and language_code.",
    );
  }
  return {
    locationCode: o.location_code ?? m.locationCode,
    languageCode: o.language_code ?? m.languageCode,
  };
}

function newRequest(v: {
  clientId: number | null;
  userId: number | null;
  kind: Kind;
  params: unknown;
  cacheKey?: string | null;
  status: "pending" | "ready" | "failed";
  taskIds?: unknown;
  error?: string | null;
}): number {
  const now = new Date();
  const row = db
    .insert(extDfsRequests)
    .values({
      clientId: v.clientId,
      userId: v.userId,
      kind: v.kind,
      paramsJson: JSON.stringify(v.params),
      cacheKey: v.cacheKey ?? null,
      status: v.status,
      taskIdsJson: v.taskIds ? JSON.stringify(v.taskIds) : null,
      error: v.error ?? null,
      createdAt: now,
      completedAt: v.status === "pending" ? null : now,
    })
    .returning({ id: extDfsRequests.id })
    .get();
  return row.id;
}

function finishRequest(id: number, status: "ready" | "failed", error?: string | null): void {
  db.update(extDfsRequests)
    .set({ status, error: error ?? null, completedAt: new Date() })
    .where(and(eq(extDfsRequests.id, id), eq(extDfsRequests.status, "pending")))
    .run();
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const AMBIGUOUS_NOTE =
  " The call may have been charged by DataForSEO; the estimated cost was kept on the ledger and it was not retried.";

/**
 * A paid call failed after reserving. Normally nothing was charged and the
 * reservation is released. When the failure is ambiguous (network error or
 * timeout after sending) DataForSEO may already have billed, so the
 * reservation is settled at its estimate instead. Returns the error text to
 * record on the request.
 */
function abandonReservation(res: Reservation, e: unknown): string {
  if (e instanceof DataForSeoError && e.ambiguous) {
    settle(res.id, res.estimatedMicros);
    return errText(e) + AMBIGUOUS_NOTE;
  }
  release(res.id, "failed");
  return errText(e);
}

/** reserve(), raising the 100% alert when the call is blocked by a cap. */
async function reserveAlerting(input: ReserveInput): Promise<Reservation> {
  try {
    return await reserve(input);
  } catch (e) {
    if (e instanceof BudgetError && e.capUsd !== null) {
      if (e.scope === "team") await raiseCapAlert("team", e.spentUsd, e.capUsd);
      else if (e.scope === "user" && input.userId !== null) await raiseCapAlert("user:" + input.userId, e.spentUsd, e.capUsd);
    }
    throw e;
  }
}

/**
 * Cache-only reads must not let a user of client A read data that was paid
 * for another client's domain: for callers who do not see every client, only
 * the client's own domain and its competitors are readable.
 */
async function assertCacheTargets(clientId: number, targets: string[], cacheOnly?: boolean): Promise<void> {
  if (!cacheOnly) return;
  const seesAll = getMcpContext() ? mcpSeesAll() : (await visibleClientIdsForAction()) === null;
  if (seesAll) return;
  const allowed = new Set<string>();
  const own = await clientDomain(clientId);
  if (own) allowed.add(own);
  for (const c of db.select({ url: competitorsTable.url }).from(competitorsTable).where(eq(competitorsTable.clientId, clientId)).all()) {
    const d = backlinksApi.bareDomain(c.url);
    if (d) allowed.add(d);
  }
  for (const t of targets) {
    if (!allowed.has(backlinksApi.bareDomain(t))) {
      throw new Error(
        `Cached data is only readable for this client's own domain or its competitors; "${t}" is neither. Add it as a competitor first.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

export type VolumeResult =
  | { status: "ready"; requestId: number | null; rows: CachedMetric[]; cached: number; paid: number; costUsd: number }
  | { status: "pending"; requestId: number; rows: CachedMetric[]; pendingKeywords: string[] }
  | { status: "cache_miss"; rows: CachedMetric[]; misses: string[] };

const toMetricRow = (r: volumeApi.VolumeRow): MetricRow => ({ ...r });
const emptyRow = (keyword: string): MetricRow => ({
  keyword, volume: null, cpc: null, competition: null, competitionIndex: null, lowBid: null, highBid: null, trend: null,
});

/** Cache rows for a fetched chunk, including empty rows for keywords DFS returned nothing for. */
async function cacheVolumeChunk(chunk: string[], rows: volumeApi.VolumeRow[], m: { locationCode: number; languageCode: string }) {
  const got = new Set(rows.map((r) => r.keyword));
  await putMetrics([...rows.map(toMetricRow), ...chunk.filter((k) => !got.has(k)).map(emptyRow)], m);
}

export async function getVolumes(
  opts: CommonOpts & { keywords: string[]; mode?: Mode },
): Promise<VolumeResult> {
  const readUser = await guardRead(opts.clientId);
  const keywords = normalizeKeywords(opts.keywords);
  const m = await resolveMarket(opts.clientId, opts);
  const { hits, misses } = await getCachedMetrics(keywords, m);
  const rows = [...hits.values()];

  if (hits.size > 0) {
    recordCacheHit({
      userId: readUser, clientId: opts.clientId, endpoint: "search_volume", mode: "standard",
      units: hits.size, savedMicros: estimateMicros("search_volume", "standard", tasksForKeywords(hits.size)),
    });
  }
  if (misses.length === 0) {
    return { status: "ready", requestId: null, rows, cached: hits.size, paid: 0, costUsd: 0 };
  }
  if (opts.cacheOnly) return { status: "cache_miss", rows, misses };

  if (!(await isConfigured())) throw new DataForSeoError("DataForSEO is not configured.", null, false);
  const userId = await guardPaid(opts.clientId);
  const settings = await getSettings();
  const mode: Mode = opts.mode ?? settings.defaultMode;

  // Do not pay twice for keywords an in-flight request of this client already covers.
  const inflight = inflightVolumeKeywords(opts.clientId, m);
  const toFetch = misses.filter((k) => !inflight.keywords.has(k));
  if (toFetch.length === 0) {
    return { status: "pending", requestId: inflight.requestId!, rows, pendingKeywords: misses };
  }
  const chunks = volumeApi.chunkKeywords(toFetch);
  const params = { keywords: toFetch, ...m, mode };

  if (mode === "live") {
    const requestId = newRequest({ clientId: opts.clientId, userId, kind: "volume", params, status: "pending" });
    let cost = 0;
    let failure: string | null = null;
    try {
      for (const chunk of chunks) {
        const res = await reserveAlerting({ userId, clientId: opts.clientId, endpoint: "search_volume", mode, units: 1, requestId });
        let out: Awaited<ReturnType<typeof volumeApi.volumeLive>>;
        try {
          out = await volumeApi.volumeLive({ keywords: chunk, ...m });
        } catch (e) {
          failure = abandonReservation(res, e);
          throw e;
        }
        settle(res.id, costToMicros(out.costUsd), out.taskId);
        cost += out.costUsd;
        await cacheVolumeChunk(chunk, out.rows, m);
        await checkAlerts({ userId });
      }
    } catch (e) {
      finishRequest(requestId, "failed", failure ?? errText(e));
      throw e;
    }
    finishRequest(requestId, "ready");
    return { status: "ready", requestId, rows: await collect(keywords, m), cached: hits.size, paid: misses.length, costUsd: cost };
  }

  // Standard queue: one task per <=1000 keywords, never one per keyword.
  const requestId = newRequest({ clientId: opts.clientId, userId, kind: "volume", params, status: "pending" });
  const tasks: TaskState[] = [];
  let firstError: unknown = null;
  let firstErrorText: string | null = null;
  for (const chunk of chunks) {
    let res: Awaited<ReturnType<typeof reserve>>;
    try {
      res = await reserveAlerting({ userId, clientId: opts.clientId, endpoint: "search_volume", mode, units: 1, requestId });
    } catch (e) {
      firstError = e;
      break;
    }
    try {
      const posted = await volumeApi.volumePost({ keywords: chunk, ...m });
      attachTask(res.id, posted.taskId, requestId);
      // DataForSEO charges when the task is set; settle now when it says what it cost.
      if (posted.costUsd > 0) settle(res.id, costToMicros(posted.costUsd), posted.taskId);
      tasks.push({ taskId: posted.taskId, ledgerId: res.id, keywords: chunk, done: false });
    } catch (e) {
      firstErrorText = abandonReservation(res, e);
      firstError = e;
      break;
    }
  }
  if (tasks.length === 0) {
    finishRequest(requestId, "failed", firstErrorText ?? errText(firstError));
    throw firstError;
  }
  db.update(extDfsRequests)
    .set({ taskIdsJson: JSON.stringify(tasks), error: firstError ? "Some batches were not posted: " + (firstErrorText ?? errText(firstError)) : null })
    .where(eq(extDfsRequests.id, requestId))
    .run();
  await checkAlerts({ userId });
  return { status: "pending", requestId, rows, pendingKeywords: misses };
}

/** Keywords (and the first request id) of this client's pending volume requests for a market. */
function inflightVolumeKeywords(clientId: number, m: { locationCode: number; languageCode: string }) {
  const out = { keywords: new Set<string>(), requestId: null as number | null };
  const rows = db
    .select()
    .from(extDfsRequests)
    .where(and(eq(extDfsRequests.status, "pending"), eq(extDfsRequests.kind, "volume"), eq(extDfsRequests.clientId, clientId)))
    .all();
  for (const r of rows) {
    let p: { keywords?: string[]; locationCode?: number; languageCode?: string };
    try {
      p = JSON.parse(r.paramsJson);
    } catch {
      continue;
    }
    if (p.locationCode !== m.locationCode || p.languageCode !== m.languageCode) continue;
    const tasks: TaskState[] = r.taskIdsJson ? JSON.parse(r.taskIdsJson) : [];
    const kws = tasks.length ? tasks.filter((t) => !t.done).flatMap((t) => t.keywords) : (p.keywords ?? []);
    if (kws.length === 0) continue;
    for (const k of kws) out.keywords.add(k);
    out.requestId ??= r.id;
  }
  return out;
}

async function collect(keywords: string[], m: { locationCode: number; languageCode: string }): Promise<CachedMetric[]> {
  return [...(await getCachedMetrics(keywords, m)).hits.values()];
}

type TaskState = { taskId: string; ledgerId: number; keywords: string[]; done: boolean; failed?: boolean };

const STALE_PENDING_MS = 48 * 3_600_000;

/**
 * Read-modify-write of a request's task states inside one synchronous
 * better-sqlite3 transaction (no await), OR-ing the `done`/`failed` flags so
 * two overlapping polls (scheduler + pending-page action) cannot lose an update.
 */
export function mergeTaskStates(requestId: number, mine: TaskState[]): TaskState[] {
  const tx = sqlite.transaction((): TaskState[] => {
    const row = sqlite.prepare("SELECT task_ids_json AS j FROM ext_dfs_requests WHERE id = ?").get(requestId) as { j: string | null } | undefined;
    const theirs: TaskState[] = row?.j ? JSON.parse(row.j) : [];
    const byId = new Map(theirs.map((t) => [t.taskId, t]));
    const out = mine.map((t) => {
      const o = byId.get(t.taskId);
      if (!o) return t;
      return { ...t, done: t.done || o.done, failed: t.done ? t.failed : o.done ? o.failed : t.failed };
    });
    for (const o of theirs) if (!out.some((t) => t.taskId === o.taskId)) out.push(o);
    sqlite.prepare("UPDATE ext_dfs_requests SET task_ids_json = ? WHERE id = ?").run(JSON.stringify(out), requestId);
    return out;
  });
  return tx.immediate();
}

/**
 * Collect finished standard-queue tasks: fills caches, settles any still
 * reserved cost, and marks requests ready/failed. Idempotent and safe to
 * run concurrently: every write is guarded by status (`settle` only
 * affects `reserved` rows, the request flips only from `pending`, cache
 * writes are upserts). task_get is free.
 */
export async function pollPendingRequests(): Promise<{ checked: number; completed: number; failed: number }> {
  const pending = db
    .select()
    .from(extDfsRequests)
    .where(and(eq(extDfsRequests.status, "pending"), eq(extDfsRequests.kind, "volume")))
    .all();
  const out = { checked: pending.length, completed: 0, failed: 0 };
  if (pending.length === 0) return out;

  let ready: Set<string>;
  try {
    ready = new Set(await volumeApi.volumeTasksReady()); // auth/funds errors here are transient too
  } catch {
    return out; // transient; try again next tick
  }

  for (const req of pending) {
    const tasks: TaskState[] = req.taskIdsJson ? JSON.parse(req.taskIdsJson) : [];
    const params = JSON.parse(req.paramsJson) as { locationCode: number; languageCode: string };
    for (const t of tasks) {
      if (t.done || !ready.has(t.taskId)) continue;
      try {
        const got = await volumeApi.volumeTaskGet(t.taskId);
        await cacheVolumeChunk(t.keywords, got.rows, params);
        if (settle(t.ledgerId, costToMicros(got.costUsd), t.taskId)) {
          await checkAlerts({ userId: req.userId });
        }
        t.done = true;
      } catch (e) {
        // Auth/funds errors on the free task_get are transient (fix the account, next poll recovers).
        if (e instanceof DataForSeoError && !e.retryable && e.code !== null && !isAuthOrFundsError(e)) {
          release(t.ledgerId, "failed");
          t.done = true;
          t.failed = true;
        }
        // retryable / network: leave for the next poll
      }
    }
    // Merge with what a concurrent poll may have written meanwhile: a task is never un-done.
    const merged = mergeTaskStates(req.id, tasks);
    tasks.splice(0, tasks.length, ...merged);
    const allDone = tasks.length > 0 && tasks.every((t) => t.done);
    const stale = Date.now() - req.createdAt.getTime() > STALE_PENDING_MS;
    if (allDone) {
      const anyFailed = tasks.some((t) => t.failed);
      finishRequest(req.id, anyFailed && tasks.every((t) => t.failed) ? "failed" : "ready", anyFailed ? "Some DataForSEO tasks failed." : req.error);
      out.completed++;
    } else if (stale) {
      for (const t of tasks) if (!t.done) release(t.ledgerId, "failed");
      finishRequest(req.id, "failed", "Timed out waiting for DataForSEO tasks.");
      out.failed++;
    }
  }
  return out;
}

export type RequestView = {
  id: number;
  kind: string;
  status: "pending" | "ready" | "failed";
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  data: unknown;
};

/** Status + data for one request; null when it does not exist for this client. */
export async function getRequest(requestId: number, clientId: number): Promise<RequestView | null> {
  await guardRead(clientId);
  const row = db.select().from(extDfsRequests).where(eq(extDfsRequests.id, requestId)).get();
  if (!row || row.clientId !== clientId) return null;
  let data: unknown = null;
  if (row.kind === "volume") {
    const p = JSON.parse(row.paramsJson) as { keywords: string[]; locationCode: number; languageCode: string };
    const c = await getCachedMetrics(p.keywords, p);
    data = { rows: [...c.hits.values()], missing: c.misses };
  } else if (row.cacheKey) {
    data = (await getCachedResponse(row.cacheKey))?.data ?? null;
  }
  return {
    id: row.id, kind: row.kind, status: row.status, error: row.error,
    createdAt: row.createdAt, completedAt: row.completedAt, data,
  };
}

// ---------------------------------------------------------------------------
// Generic live endpoints (Labs + Backlinks)
// ---------------------------------------------------------------------------

export type LiveResult<T> =
  | { status: "ready"; requestId: number; data: T; cached: boolean; fetchedAt: Date; costUsd: number }
  | { status: "cache_miss" };

async function liveCall<T>(a: {
  clientId: number;
  kind: Kind;
  endpoint: EndpointId;
  ttl: TtlKind;
  params: Record<string, unknown>;
  units: number;
  cacheOnly?: boolean;
  backlinks?: boolean;
  run: () => Promise<{ data: T; costUsd: number }>;
}): Promise<LiveResult<T>> {
  const readUser = await guardRead(a.clientId);
  const key = cacheKeyFor(a.endpoint, a.params);
  const hit = await getCachedResponse<T>(key);
  if (hit) {
    recordCacheHit({
      userId: readUser, clientId: a.clientId, endpoint: a.endpoint, mode: "live",
      savedMicros: estimateMicros(a.endpoint, "live", a.units),
    });
    const requestId = newRequest({ clientId: a.clientId, userId: readUser, kind: a.kind, params: a.params, cacheKey: key, status: "ready" });
    return { status: "ready", requestId, data: hit.data, cached: true, fetchedAt: hit.fetchedAt, costUsd: 0 };
  }
  if (a.cacheOnly) return { status: "cache_miss" };

  if (a.backlinks && !(await getSettings()).backlinksEnabled) {
    throw new Error("Backlink data from DataForSEO is switched off. Enable it in DataForSEO settings first.");
  }
  if (!(await isConfigured())) throw new DataForSeoError("DataForSEO is not configured.", null, false);
  const userId = await guardPaid(a.clientId);
  const requestId = newRequest({ clientId: a.clientId, userId, kind: a.kind, params: a.params, cacheKey: key, status: "pending" });
  let res: Awaited<ReturnType<typeof reserve>>;
  try {
    res = await reserveAlerting({ userId, clientId: a.clientId, endpoint: a.endpoint, mode: "live", units: a.units, requestId });
  } catch (e) {
    finishRequest(requestId, "failed", errText(e));
    throw e;
  }
  let out: { data: T; costUsd: number };
  try {
    out = await a.run();
  } catch (e) {
    finishRequest(requestId, "failed", abandonReservation(res, e));
    throw e;
  }
  settle(res.id, costToMicros(out.costUsd));
  await putCachedResponse(key, a.endpoint, out.data, costToMicros(out.costUsd), a.ttl);
  finishRequest(requestId, "ready");
  await checkAlerts({ userId });
  return { status: "ready", requestId, data: out.data, cached: false, fetchedAt: new Date(), costUsd: out.costUsd };
}

type ListOpts = CommonOpts & { limit?: number };
const limitOf = (o: { limit?: number }) => Math.max(1, Math.min(o.limit ?? DEFAULT_ROW_LIMIT, 1000));

export async function keywordIdeas(opts: ListOpts & { seeds: string[]; variant?: "ideas" | "suggestions" }) {
  const m = await resolveMarket(opts.clientId, opts);
  // Sorted so the same seeds in any order share one cache key.
  const seeds = normalizeKeywords(opts.seeds).sort();
  if (seeds.length === 0) throw new Error("Give at least one seed keyword.");
  const limit = limitOf(opts);
  const suggestions = opts.variant === "suggestions";
  // The suggestions endpoint takes ONE keyword; key on exactly what is sent.
  const keyed = suggestions ? seeds.slice(0, 1) : seeds;
  return liveCall({
    clientId: opts.clientId, kind: "ideas", ttl: "labs", units: limit, cacheOnly: opts.cacheOnly,
    endpoint: suggestions ? "labs_keyword_suggestions" : "labs_keyword_ideas",
    params: { seeds: keyed, ...m, limit, suggestions },
    run: async () => {
      const r = suggestions
        ? await labsApi.keywordSuggestionsLive({ keyword: seeds[0], ...m, limit })
        : await labsApi.keywordIdeasLive({ keywords: seeds, ...m, limit });
      return { data: { total: r.total, items: r.items }, costUsd: r.costUsd };
    },
  });
}

/** Keywords a domain ranks for. `target` defaults to the client's own domain. */
export async function rankedKeywords(opts: ListOpts & { target?: string }) {
  const m = await resolveMarket(opts.clientId, opts);
  const target = backlinksApi.bareDomain(opts.target ?? (await clientDomain(opts.clientId)) ?? "");
  if (!target) throw new Error("No target domain: pass `target` or set the client's URL.");
  await assertCacheTargets(opts.clientId, [target], opts.cacheOnly);
  const limit = limitOf(opts);
  return liveCall({
    clientId: opts.clientId, kind: "ranked_keywords", ttl: "labs", units: limit, cacheOnly: opts.cacheOnly,
    endpoint: "labs_ranked_keywords", params: { target, ...m, limit },
    run: async () => {
      const r = await labsApi.rankedKeywordsLive({ target, ...m, limit });
      return { data: { total: r.total, items: r.items }, costUsd: r.costUsd };
    },
  });
}

async function targetOf(clientId: number, target?: string, cacheOnly?: boolean): Promise<string> {
  const t = backlinksApi.bareDomain(target ?? (await clientDomain(clientId)) ?? "");
  if (!t) throw new Error("No target domain: pass `target` or set the client's URL.");
  await assertCacheTargets(clientId, [t], cacheOnly);
  return t;
}

export async function backlinksSummary(opts: CommonOpts & { target?: string }) {
  const target = await targetOf(opts.clientId, opts.target, opts.cacheOnly);
  return liveCall({
    clientId: opts.clientId, kind: "backlinks_summary", ttl: "backlinks", units: 1, cacheOnly: opts.cacheOnly,
    backlinks: true, endpoint: "backlinks_summary", params: { target },
    run: async () => {
      const r = await backlinksApi.summaryLive(target);
      return { data: r.summary, costUsd: r.costUsd };
    },
  });
}

export async function backlinksList(opts: ListOpts & { target?: string }) {
  const target = await targetOf(opts.clientId, opts.target, opts.cacheOnly);
  const limit = limitOf(opts);
  return liveCall({
    clientId: opts.clientId, kind: "backlinks_list", ttl: "backlinks", units: limit, cacheOnly: opts.cacheOnly,
    backlinks: true, endpoint: "backlinks_list", params: { target, limit },
    run: async () => {
      const r = await backlinksApi.backlinksLive({ target, limit });
      return { data: { total: r.total, items: r.items }, costUsd: r.costUsd };
    },
  });
}

export async function referringDomains(opts: ListOpts & { target?: string }) {
  const target = await targetOf(opts.clientId, opts.target, opts.cacheOnly);
  const limit = limitOf(opts);
  return liveCall({
    clientId: opts.clientId, kind: "referring_domains", ttl: "backlinks", units: limit, cacheOnly: opts.cacheOnly,
    backlinks: true, endpoint: "backlinks_referring_domains", params: { target, limit },
    run: async () => {
      const r = await backlinksApi.referringDomainsLive({ target, limit });
      return { data: { total: r.total, items: r.items }, costUsd: r.costUsd };
    },
  });
}

/** Domains that link to the competitors but NOT to the client (or `target`). */
export async function backlinkGap(opts: ListOpts & { competitors: string[]; target?: string }) {
  const target = await targetOf(opts.clientId, opts.target, opts.cacheOnly);
  const competitors = [...new Set(opts.competitors.map(backlinksApi.bareDomain).filter(Boolean))];
  if (competitors.length === 0) throw new Error("Give at least one competitor domain.");
  await assertCacheTargets(opts.clientId, competitors, opts.cacheOnly);
  const limit = limitOf(opts);
  return liveCall({
    clientId: opts.clientId, kind: "backlink_gap", ttl: "backlinks", units: limit, cacheOnly: opts.cacheOnly,
    backlinks: true, endpoint: "backlinks_domain_intersection", params: { target, competitors: [...competitors].sort(), limit },
    run: async () => {
      const r = await backlinksApi.domainIntersectionLive({ competitors, exclude: target, limit });
      return { data: { total: r.total, items: r.items }, costUsd: r.costUsd };
    },
  });
}
