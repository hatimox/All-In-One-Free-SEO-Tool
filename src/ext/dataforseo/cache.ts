/**
 * Caching for DataForSEO data. Paid data is cached by default so the same
 * keyword/response is never paid for twice inside its TTL.
 *  - keyword-level metrics (ext_keyword_metrics): partial batches only pay for misses
 *  - generic responses (ext_dfs_cache) keyed by sha256(endpoint + normalized params)
 * TTLs come from settings (`dataforseo.ttl_days`).
 */
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { extDfsCache, extKeywordMetrics } from "../db/schema";
import { getSettings } from "./config";

export type TtlKind = "volume" | "labs" | "backlinks";
const DAY = 86_400_000;

export function normalizeKeyword(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Normalize, drop empties, de-duplicate (order kept). */
export function normalizeKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  for (const k of list) {
    const n = normalizeKeyword(k);
    if (n) seen.add(n);
  }
  return [...seen];
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, stable(x)]),
    );
  }
  return v;
}

export function cacheKeyFor(endpoint: string, params: unknown): string {
  return crypto.createHash("sha256").update(endpoint + "\n" + JSON.stringify(stable(params))).digest("hex");
}

export async function ttlMs(kind: TtlKind): Promise<number> {
  return (await getSettings()).ttlDays[kind] * DAY;
}

// --- keyword metrics --------------------------------------------------------

export type MetricRow = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionIndex: number | null;
  lowBid: number | null;
  highBid: number | null;
  trend: number[] | null;
};
export type CachedMetric = MetricRow & { source: string; fetchedAt: Date };

type Mk = { locationCode: number; languageCode: string; source?: string };

export async function getCachedMetrics(
  keywords: string[],
  m: Mk,
  now = Date.now(),
): Promise<{ hits: Map<string, CachedMetric>; misses: string[] }> {
  const kws = normalizeKeywords(keywords);
  const hits = new Map<string, CachedMetric>();
  const source = m.source ?? "dataforseo";
  for (let i = 0; i < kws.length; i += 500) {
    const rows = db
      .select()
      .from(extKeywordMetrics)
      .where(
        and(
          inArray(extKeywordMetrics.keyword, kws.slice(i, i + 500)),
          eq(extKeywordMetrics.locationCode, m.locationCode),
          eq(extKeywordMetrics.languageCode, m.languageCode),
          eq(extKeywordMetrics.source, source),
        ),
      )
      .all();
    for (const r of rows) {
      if (r.expiresAt.getTime() <= now) continue;
      hits.set(r.keyword, {
        keyword: r.keyword,
        volume: r.volume,
        cpc: r.cpc,
        competition: r.competition,
        competitionIndex: r.competitionIndex,
        lowBid: r.lowBid,
        highBid: r.highBid,
        trend: r.trendJson ? (JSON.parse(r.trendJson) as number[]) : null,
        source: r.source,
        fetchedAt: r.fetchedAt,
      });
    }
  }
  return { hits, misses: kws.filter((k) => !hits.has(k)) };
}

export async function putMetrics(rows: MetricRow[], m: Mk, now = Date.now()): Promise<void> {
  if (!rows.length) return;
  const source = m.source ?? "dataforseo";
  const expiresAt = new Date(now + (await ttlMs("volume")));
  const fetchedAt = new Date(now);
  for (const r of rows) {
    const values = {
      keyword: normalizeKeyword(r.keyword),
      locationCode: m.locationCode,
      languageCode: m.languageCode,
      volume: r.volume,
      cpc: r.cpc,
      competition: r.competition,
      competitionIndex: r.competitionIndex,
      lowBid: r.lowBid,
      highBid: r.highBid,
      trendJson: r.trend ? JSON.stringify(r.trend) : null,
      source,
      fetchedAt,
      expiresAt,
    };
    db.insert(extKeywordMetrics)
      .values(values)
      .onConflictDoUpdate({
        target: [extKeywordMetrics.keyword, extKeywordMetrics.locationCode, extKeywordMetrics.languageCode, extKeywordMetrics.source],
        set: values,
      })
      .run();
  }
}

// --- generic response cache ---------------------------------------------------

export async function getCachedResponse<T>(key: string, now = Date.now()): Promise<{ data: T; fetchedAt: Date } | null> {
  const row = db.select().from(extDfsCache).where(eq(extDfsCache.cacheKey, key)).get();
  if (!row || row.expiresAt.getTime() <= now) return null;
  return { data: JSON.parse(row.responseJson) as T, fetchedAt: row.fetchedAt };
}

export async function putCachedResponse(
  key: string,
  endpoint: string,
  data: unknown,
  costMicros: number,
  kind: TtlKind,
  now = Date.now(),
): Promise<void> {
  const values = {
    cacheKey: key,
    endpoint,
    responseJson: JSON.stringify(data),
    costMicros,
    fetchedAt: new Date(now),
    expiresAt: new Date(now + (await ttlMs(kind))),
  };
  db.insert(extDfsCache).values(values).onConflictDoUpdate({ target: extDfsCache.cacheKey, set: values }).run();
}
