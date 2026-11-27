/**
 * One keyword, three answers: metrics (existing provider chain), difficulty
 * and search intent. Difficulty and intent come from DataForSEO only; when it
 * is not configured (or the value is not cached and spending is not allowed)
 * difficulty is `{source:"estimate", difficulty:null, needsFreeEstimate:true}`
 * so the UI can offer the free estimator, and intent is null.
 * With allowSpend true, budget / permission / account errors and
 * possibly-charged calls are thrown, exactly as in keyword-metrics.
 */
import { normalizeKeywords } from "../dataforseo/cache";
import { isConfigured } from "../dataforseo/config";
import { resolveMarket as resolveCountryMarket } from "../dataforseo/market";
import { BudgetError } from "../dataforseo/budget";
import { DataForSeoError, isAuthOrFundsError } from "../dataforseo/client";
import { keywordDifficulty, searchIntent } from "../dataforseo/service";
import { PaidForbiddenError } from "../access/paid-guard";
import { getKeywordMetrics, type KeywordMetric, type MetricMarket } from "./keyword-metrics";
import type { DataSource } from "./sources";

export type DifficultyInfo = {
  source: DataSource;
  difficulty: number | null;
  /** True when the UI should offer the free estimator (estimateDifficulty). */
  needsFreeEstimate?: boolean;
  cached?: boolean;
  fallbackReason?: string;
};

export type IntentInfo = {
  source: DataSource | null;
  intent: string | null;
  probability: number | null;
  secondary: { intent: string; probability: number | null }[];
  cached?: boolean;
  fallbackReason?: string;
};

export type KeywordOverview = {
  keyword: string;
  metrics: KeywordMetric | null;
  metricsStatus: "ready" | "pending";
  difficulty: DifficultyInfo;
  intent: IntentInfo;
};

function mustThrow(e: unknown): boolean {
  return (
    e instanceof BudgetError ||
    e instanceof PaidForbiddenError ||
    (e instanceof DataForSeoError && (isAuthOrFundsError(e) || e.ambiguous))
  );
}

export async function getKeywordOverview(opts: {
  clientId: number;
  keyword: string;
  market?: MetricMarket;
  allowSpend: boolean;
}): Promise<KeywordOverview> {
  const [keyword] = normalizeKeywords([opts.keyword]);
  if (!keyword) throw new Error("Give a keyword.");

  // Resolve the market once so every call (and its cache key) agrees.
  let loc: { location_code?: number; language_code?: string } = {};
  const mk = opts.market;
  if (mk?.locationCode && mk.languageCode) loc = { location_code: mk.locationCode, language_code: mk.languageCode };
  else if (mk?.country) {
    const r = resolveCountryMarket(mk.country, mk.language);
    if (!r) throw new Error(`Unsupported country "${mk.country}": no DataForSEO location is known for it.`);
    loc = { location_code: r.locationCode, language_code: r.languageCode };
  }

  const metricsRes = await getKeywordMetrics({ clientId: opts.clientId, keywords: [keyword], market: opts.market, allowSpend: opts.allowSpend });
  const metrics = metricsRes.items[0] ?? null;

  let difficulty: DifficultyInfo = { source: "estimate", difficulty: null, needsFreeEstimate: true };
  let intent: IntentInfo = { source: null, intent: null, probability: null, secondary: [] };

  if (!(await isConfigured())) {
    const why = "DataForSEO is not configured";
    return {
      keyword, metrics, metricsStatus: metricsRes.status,
      difficulty: { ...difficulty, fallbackReason: why },
      intent: { ...intent, fallbackReason: why },
    };
  }

  const common = { clientId: opts.clientId, keywords: [keyword], cacheOnly: !opts.allowSpend, ...loc };
  const missReason = "DataForSEO result not cached and spending was not allowed";

  try {
    const r = await keywordDifficulty(common);
    if (r.status === "cache_miss") difficulty = { ...difficulty, fallbackReason: missReason };
    else {
      const row = r.data.items.find((i) => i.keyword === keyword);
      difficulty = row?.difficulty != null
        ? { source: "dataforseo", difficulty: row.difficulty, cached: r.cached }
        : { source: "estimate", difficulty: null, needsFreeEstimate: true, fallbackReason: "DataForSEO has no difficulty for this keyword" };
    }
  } catch (e) {
    if (opts.allowSpend && mustThrow(e)) throw e;
    difficulty = { ...difficulty, fallbackReason: `DataForSEO unavailable: ${(e as Error).message}` };
  }

  try {
    const r = await searchIntent(common);
    if (r.status === "cache_miss") intent = { ...intent, fallbackReason: missReason };
    else {
      const row = r.data.items.find((i) => i.keyword === keyword);
      intent = row?.intent
        ? { source: "dataforseo", intent: row.intent, probability: row.probability, secondary: row.secondary, cached: r.cached }
        : { ...intent, fallbackReason: "DataForSEO has no intent for this keyword" };
    }
  } catch (e) {
    if (opts.allowSpend && mustThrow(e)) throw e;
    intent = { ...intent, fallbackReason: `DataForSEO unavailable: ${(e as Error).message}` };
  }

  return { keyword, metrics, metricsStatus: metricsRes.status, difficulty, intent };
}
