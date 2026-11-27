/**
 * Keyword metrics with a provider fallback chain:
 *   DataForSEO (configured, and allowSpend or cached)
 *   -> Google Keyword Planner (connected)
 *   -> Bing Webmaster (key set)
 *   -> free estimate (Trends + autocomplete buckets)
 * With allowSpend false, a failure falls to the next provider with
 * `fallbackReason` set. With allowSpend true, BudgetError, PaidForbiddenError
 * and account errors (auth / insufficient funds) or a possibly-charged call
 * are thrown so callers show them; other outages still fall back. While a paid standard-queue task is pending the
 * result status is "pending": fallback values are returned but marked
 * `pending: true` so a UI can show them as provisional.
 */
import { getAdsStatus, keywordMetrics as adsKeywordMetrics } from "@/lib/google-ads";
import { getBingApiKey, getBingKeywordVolumes } from "@/lib/bing-webmaster";
import { estimateBulk, type VolumeBucket } from "@/lib/search-volume";
import { normalizeKeywords } from "../dataforseo/cache";
import { isConfigured } from "../dataforseo/config";
import { marketForClient, resolveMarket } from "../dataforseo/market";
import { BudgetError } from "../dataforseo/budget";
import { getVolumes } from "../dataforseo/service";
import { DataForSeoError, isAuthOrFundsError } from "../dataforseo/client";
import { PaidForbiddenError } from "../access/paid-guard";
import type { DataSource } from "./sources";

export type MetricMarket = {
  country?: string | null;
  language?: string | null;
  locationCode?: number;
  languageCode?: string;
};

export type KeywordMetric = {
  keyword: string;
  volume: number | null;
  volumeBucket?: VolumeBucket;
  cpc: number | null;
  competition: number | null;
  trend: number[] | null;
  source: DataSource;
  fetchedAt: Date;
  /** Served from the DataForSEO cache (no spend). */
  cached: boolean;
  /** Why a higher-priority provider was skipped for this keyword. */
  fallbackReason?: string;
  /** Provisional: a paid task for this keyword is still in the standard queue. */
  pending?: boolean;
};

export type KeywordMetricsResult = {
  status: "ready" | "pending";
  requestId?: number;
  items: KeywordMetric[];
};

export async function getKeywordMetrics(opts: {
  clientId: number;
  keywords: string[];
  market?: MetricMarket;
  allowSpend: boolean;
}): Promise<KeywordMetricsResult> {
  const keywords = normalizeKeywords(opts.keywords);
  const done = new Map<string, KeywordMetric>();
  const remaining = () => keywords.filter((k) => !done.has(k));
  let status: "ready" | "pending" = "ready";
  let requestId: number | undefined;
  const reasons = new Map<string, string>();
  const setReason = (r: string) => remaining().forEach((k) => reasons.set(k, r));

  const explicit = opts.market?.locationCode && opts.market.languageCode;
  const mk = explicit
    ? { country: opts.market!.country ?? null, language: opts.market!.language ?? opts.market!.languageCode!, locationCode: opts.market!.locationCode!, languageCode: opts.market!.languageCode! }
    : opts.market?.country
      ? resolveMarket(opts.market.country, opts.market.language)
      : await marketForClient(opts.clientId);
  // A country the caller asked for must never silently become the client's market (and be paid for).
  if (!explicit && opts.market?.country && !mk) {
    throw new Error(
      `Unsupported country "${opts.market.country}": no DataForSEO location is known for it. Use a supported ISO country code or pass location_code and language_code.`,
    );
  }
  const country = (mk?.country ?? opts.market?.country ?? "US") as string;
  const language = mk?.language ?? opts.market?.language ?? "en";

  // 1. DataForSEO
  if (keywords.length && (await isConfigured())) {
    const started = Date.now() - 1000;
    try {
      const r = await getVolumes({
        clientId: opts.clientId,
        keywords,
        cacheOnly: !opts.allowSpend,
        location_code: mk?.locationCode,
        language_code: mk?.languageCode,
      });
      for (const row of r.rows) {
        done.set(row.keyword, {
          keyword: row.keyword, volume: row.volume, cpc: row.cpc, competition: row.competition,
          trend: row.trend, source: "dataforseo", fetchedAt: row.fetchedAt,
          cached: row.fetchedAt.getTime() < started,
        });
      }
      if (r.status === "pending") {
        status = "pending";
        requestId = r.requestId;
        setReason("DataForSEO standard-queue task pending; provisional value shown");
      } else if (r.status === "cache_miss") {
        setReason("DataForSEO result not cached and spending was not allowed");
      }
    } catch (e) {
      // When the caller asked to spend, budget / permission / account (auth, funds) failures
      // and possibly-charged calls must be loud, not hidden behind a free fallback.
      if (
        opts.allowSpend &&
        (e instanceof BudgetError ||
          e instanceof PaidForbiddenError ||
          (e instanceof DataForSeoError && (isAuthOrFundsError(e) || e.ambiguous)))
      ) {
        throw e;
      }
      setReason(`DataForSEO unavailable: ${(e as Error).message}`);
    }
  }

  const fallbackReason = (k: string) => reasons.get(k);
  const finish = (arr: Omit<KeywordMetric, "fallbackReason" | "pending">[]) => {
    for (const m of arr) {
      if (done.has(m.keyword)) continue;
      done.set(m.keyword, {
        ...m,
        ...(fallbackReason(m.keyword) ? { fallbackReason: fallbackReason(m.keyword) } : {}),
        ...(status === "pending" && reasons.get(m.keyword)?.includes("pending") ? { pending: true } : {}),
      });
    }
  };

  // 2. Google Keyword Planner
  if (remaining().length) {
    try {
      if ((await getAdsStatus()).ready) {
        const ideas = await adsKeywordMetrics({ keywords: remaining(), country, language });
        const now = new Date();
        const byKw = new Map(ideas.map((i) => [i.text.toLowerCase(), i]));
        finish(
          remaining()
            .filter((k) => byKw.has(k))
            .map((k) => {
              const i = byKw.get(k)!;
              return {
                keyword: k, volume: i.volume, cpc: i.highBid ?? null,
                competition: i.competitionIndex === null ? null : i.competitionIndex / 100,
                trend: null, source: "google_ads" as const, fetchedAt: now, cached: false,
              };
            }),
        );
      }
    } catch (e) {
      for (const k of remaining()) reasons.set(k, `${reasons.get(k) ? reasons.get(k) + "; " : ""}Google Ads failed: ${(e as Error).message}`);
    }
  }

  // 3. Bing
  if (remaining().length) {
    try {
      if (await getBingApiKey()) {
        const map = await getBingKeywordVolumes({ queries: remaining(), country, language });
        const now = new Date();
        finish(
          remaining()
            .filter((k) => map.has(k))
            .map((k) => ({
              keyword: k, volume: map.get(k) ?? null, cpc: null, competition: null, trend: null,
              source: "bing" as const, fetchedAt: now, cached: false,
            })),
        );
      }
    } catch {
      /* fall through to the estimate */
    }
  }

  // 4. Free estimate (always answers, as a bucket)
  if (remaining().length) {
    const est = await estimateBulk({ queries: remaining(), country });
    const now = new Date();
    const byQ = new Map(est.map((e) => [e.query.toLowerCase(), e]));
    finish(
      remaining().map((k) => ({
        keyword: k, volume: null, volumeBucket: byQ.get(k)?.bucket, cpc: null, competition: null, trend: null,
        source: "estimate" as const, fetchedAt: now, cached: false,
      })),
    );
  }

  return { status, requestId, items: keywords.map((k) => done.get(k)!).filter(Boolean) };
}
