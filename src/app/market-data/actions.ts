"use server";

import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { guardAction } from "@/lib/action-guard";
import { clientScope } from "@/lib/client-scope";
import { marketAccess } from "@/ext/ui/market-access";
import { getKeywordMetrics } from "@/ext/providers/keyword-metrics";
import * as dfs from "@/ext/dataforseo/service";
import { mapDfsError, type DfsError } from "@/ext/ui/dfs-errors";
import type { GapDomain, ReferringDomain, BacklinkSummary } from "@/ext/dataforseo/endpoints/backlinks";
import type { KeywordIdea, RankedKeyword } from "@/ext/dataforseo/endpoints/labs";
import { scanSerp } from "@/lib/serp-scanner";
import { estimateDifficulty, type DifficultyApiResult } from "@/app/tools/keyword-difficulty/actions";
import { trackKeyword } from "@/app/keywords/actions";
import { loadDomainView, loadIdeas, loadKeywordView, type DomainView, type IdeasList, type KeywordView, type Slice } from "./research";

/**
 * Every action takes `spend`. false = cache only, free, any role that may see
 * the client. true = a paid lookup, which needs the "edit" role (viewers are
 * refused here, and again by the service's own guardPaid) and the service
 * enforces the budget. The UI only sends spend:true from an explicit button.
 */

export type MetricView = {
  keyword: string;
  volume: number | null;
  volumeBucket?: string;
  cpc: number | null;
  competition: number | null;
  trend: number[] | null;
  source: string;
  fetchedAt: string;
  cached: boolean;
  fallbackReason?: string;
  pending?: boolean;
};

export type KeywordsOut =
  | { ok: true; status: "ready"; items: MetricView[] }
  | { ok: true; status: "pending"; requestId: number; items: MetricView[] }
  | DfsError;

export type LiveOut<T> =
  | { ok: true; status: "ready"; data: T; cached: boolean; fetchedAt: string; costUsd: number }
  | { ok: true; status: "cache_miss" }
  | DfsError;

const parseList = (text: string, max: number): string[] =>
  [...new Set(text.split(/\r?\n|,/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 200))].slice(0, max);

const idOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const BAD_CLIENT: DfsError = { ok: false, kind: "other", error: "Pick a client first." };

function ready<T>(r: dfs.LiveResult<T>): LiveOut<T> {
  if (r.status === "cache_miss") return { ok: true, status: "cache_miss" };
  return { ok: true, status: "ready", data: r.data, cached: r.cached, fetchedAt: r.fetchedAt.toISOString(), costUsd: r.costUsd };
}

export async function lookupKeywords(input: { clientId: number; keywords: string; spend: boolean }): Promise<KeywordsOut> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  const keywords = parseList(input.keywords, 1000);
  if (keywords.length === 0) return { ok: false, kind: "other", error: "Enter at least one keyword." };
  try {
    const r = await getKeywordMetrics({ clientId, keywords, allowSpend: input.spend === true });
    const items: MetricView[] = r.items.map((i) => ({ ...i, fetchedAt: i.fetchedAt.toISOString() }));
    return r.status === "pending" && r.requestId !== undefined
      ? { ok: true, status: "pending", requestId: r.requestId, items }
      : { ok: true, status: "ready", items };
  } catch (e) {
    return mapDfsError(e);
  }
}

export async function lookupIdeas(input: {
  clientId: number;
  seeds: string;
  variant: "ideas" | "suggestions";
  spend: boolean;
}): Promise<LiveOut<{ total: number; items: KeywordIdea[] }>> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  try {
    const seeds = parseList(input.seeds, 20);
    return ready(
      await dfs.keywordIdeas({ clientId, seeds, variant: input.variant === "suggestions" ? "suggestions" : "ideas", cacheOnly: !input.spend }),
    );
  } catch (e) {
    return mapDfsError(e);
  }
}

export async function lookupRankedKeywords(input: {
  clientId: number;
  target: string;
  spend: boolean;
}): Promise<LiveOut<{ total: number; items: RankedKeyword[] }>> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  try {
    return ready(await dfs.rankedKeywords({ clientId, target: input.target.trim() || undefined, cacheOnly: !input.spend }));
  } catch (e) {
    return mapDfsError(e);
  }
}

export type BacklinksOut =
  | {
      ok: true;
      status: "ready";
      summary: BacklinkSummary | null;
      domains: ReferringDomain[];
      domainsTotal: number;
      cached: boolean;
      fetchedAt: string;
      costUsd: number;
      /** Set when the summary arrived but the domains call failed. */
      partialError?: string;
    }
  | { ok: true; status: "cache_miss" }
  | DfsError;

export async function lookupBacklinks(input: { clientId: number; spend: boolean }): Promise<BacklinksOut> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  try {
    const s = await dfs.backlinksSummary({ clientId, cacheOnly: !input.spend });
    if (s.status === "cache_miss") return { ok: true, status: "cache_miss" };
    let domains: ReferringDomain[] = [];
    let domainsTotal = 0;
    let cached = s.cached;
    let cost = s.costUsd;
    let partialError: string | undefined;
    try {
      const d = await dfs.referringDomains({ clientId, limit: 100, cacheOnly: !input.spend });
      if (d.status === "ready") {
        domains = d.data.items;
        domainsTotal = d.data.total;
        cached = cached && d.cached;
        cost += d.costUsd;
      } else {
        partialError = "Referring domains are not cached yet.";
      }
    } catch (e) {
      partialError = mapDfsError(e).error;
    }
    return { ok: true, status: "ready", summary: s.data, domains, domainsTotal, cached, fetchedAt: s.fetchedAt.toISOString(), costUsd: cost, partialError };
  } catch (e) {
    return mapDfsError(e);
  }
}

export async function lookupBacklinkGap(input: {
  clientId: number;
  competitors: string[];
  spend: boolean;
}): Promise<LiveOut<{ total: number; items: GapDomain[] }>> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  try {
    return ready(await dfs.backlinkGap({ clientId, competitors: (input.competitors ?? []).slice(0, 10), cacheOnly: !input.spend }));
  } catch (e) {
    return mapDfsError(e);
  }
}

export type PendingOut =
  | {
      ok: true;
      status: "pending" | "ready" | "failed";
      error: string | null;
      rows: MetricView[];
      missing: number;
    }
  | { ok: false; kind: "other" | "forbidden"; error: string };

/** Polled by the pending screen. Collecting finished tasks is free (task_get). */
export async function pollRequest(input: { clientId: number; requestId: number }): Promise<PendingOut> {
  await guardAction("read", input.clientId);
  const clientId = idOf(input.clientId);
  const requestId = idOf(input.requestId);
  if (!clientId || !requestId) return { ok: false, kind: "other", error: "Request not found." };
  try {
    await dfs.pollPendingRequests();
    const r = await dfs.getRequest(requestId, clientId);
    if (!r) return { ok: false, kind: "other", error: "Request not found." };
    const d = (r.data ?? { rows: [], missing: [] }) as {
      rows: { keyword: string; volume: number | null; cpc: number | null; competition: number | null; trend: number[] | null; source: string; fetchedAt: Date }[];
      missing: string[];
    };
    return {
      ok: true,
      status: r.status,
      error: r.error,
      missing: d.missing?.length ?? 0,
      rows: (d.rows ?? []).map((x) => ({
        keyword: x.keyword, volume: x.volume, cpc: x.cpc, competition: x.competition, trend: x.trend,
        source: x.source ?? "dataforseo", fetchedAt: new Date(x.fetchedAt).toISOString(), cached: true,
      })),
    };
  } catch (e) {
    const m = mapDfsError(e);
    return { ok: false, kind: m.kind === "forbidden" ? "forbidden" : "other", error: m.error };
  }
}

export type ExactVolumesContext = {
  configured: boolean;
  canSpend: boolean;
  mode: "standard" | "live";
  clients: { id: number; name: string }[];
};

/** What the "Get exact volumes" panel on existing screens needs to decide whether to show itself. */
export async function exactVolumesContext(): Promise<ExactVolumesContext> {
  await guardAction("read");
  const { access, settings } = await marketAccess();
  const list = await db.select({ id: clients.id, name: clients.name }).from(clients).where(await clientScope()).orderBy(desc(clients.createdAt));
  return { configured: access.configured, canSpend: access.canSpend, mode: settings.defaultMode, clients: list };
}

// ---------------------------------------------------------------------------
// Research flow. spend:false = cache only; spend:true = the explicit paid button.
// ---------------------------------------------------------------------------

export type KeywordViewOut = { ok: true; view: KeywordView } | DfsError;
export type DomainViewOut = { ok: true; view: DomainView } | DfsError;
export type IdeasViewOut = { ok: true; slice: Slice<IdeasList> } | DfsError;

export async function fetchKeywordView(input: { clientId: number; keyword: string; country?: string; spend: boolean }): Promise<KeywordViewOut> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  if (!input.keyword?.trim()) return { ok: false, kind: "other", error: "Enter a keyword." };
  try {
    return { ok: true, view: await loadKeywordView({ clientId, keyword: input.keyword, country: input.country, spend: input.spend === true }) };
  } catch (e) {
    return mapDfsError(e);
  }
}

export async function fetchDomainView(input: { clientId: number; domain: string; country?: string; spend: boolean }): Promise<DomainViewOut> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  if (!input.domain?.trim()) return { ok: false, kind: "other", error: "Enter a domain." };
  try {
    return { ok: true, view: await loadDomainView({ clientId, domain: input.domain, country: input.country, spend: input.spend === true }) };
  } catch (e) {
    return mapDfsError(e);
  }
}

export async function fetchIdeasView(input: {
  clientId: number;
  seed: string;
  variant: "ideas" | "suggestions";
  country?: string;
  spend: boolean;
}): Promise<IdeasViewOut> {
  await guardAction(input.spend ? "edit" : "read", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return BAD_CLIENT;
  if (!input.seed?.trim()) return { ok: false, kind: "other", error: "Enter a keyword." };
  try {
    const variant = input.variant === "suggestions" ? "suggestions" : "ideas";
    return { ok: true, slice: await loadIdeas({ clientId, seed: input.seed, variant, country: input.country, spend: input.spend === true }) };
  } catch (e) {
    return mapDfsError(e);
  }
}

export type TopResultsOut =
  | { ok: true; results: { position: number; title: string; url: string; domain: string }[] }
  | { ok: false; error: string };

/** Free: scrapes Google through the browser pool. Edit role, because it uses shared scraping capacity. */
export async function scanTopResults(input: { clientId: number; keyword: string; country?: string }): Promise<TopResultsOut> {
  await guardAction("edit", input.clientId);
  const query = (input.keyword ?? "").trim();
  if (!idOf(input.clientId) || !query) return { ok: false, error: "Enter a keyword." };
  try {
    const r = await scanSerp({ query, country: input.country, topN: 10 });
    if (!r.ok) return { ok: false, error: r.error ?? "SERP scan failed. Try again in a minute." };
    return { ok: true, results: r.topResults.slice(0, 10).map((x) => ({ position: x.position, title: x.title, url: x.url, domain: x.domain })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Free heuristic difficulty from the live SERP; the UI labels it "Estimate". */
export async function estimateKeywordDifficulty(input: { clientId: number; keyword: string }): Promise<DifficultyApiResult> {
  await guardAction("edit", input.clientId);
  if (!idOf(input.clientId)) return { ok: false, error: "Pick a client first." };
  try {
    return await estimateDifficulty(input.keyword);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Track several keywords for the client (existing ones are skipped by trackKeyword). */
export async function trackKeywords(input: { clientId: number; keywords: string[]; country?: string }): Promise<{ ok: boolean; tracked: number; error?: string }> {
  await guardAction("edit", input.clientId);
  const clientId = idOf(input.clientId);
  if (!clientId) return { ok: false, tracked: 0, error: "Pick a client first." };
  const list = [...new Set((input.keywords ?? []).map((k) => k.trim()).filter(Boolean))].slice(0, 200);
  let tracked = 0;
  for (const query of list) {
    const fd = new FormData();
    fd.set("clientId", String(clientId));
    fd.set("query", query);
    fd.set("country", input.country ?? "US");
    await trackKeyword(fd);
    tracked += 1;
  }
  return { ok: true, tracked };
}
