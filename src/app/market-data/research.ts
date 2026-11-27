/**
 * Loaders for the research pages. NOT server actions: pages call these with
 * spend:false (cache only, free); the guarded actions in actions.ts call them
 * with spend:true from an explicit button. Dates are serialised so results
 * can cross into client components.
 */
import { BudgetError } from "@/ext/dataforseo/budget";
import { DataForSeoError, isAuthOrFundsError } from "@/ext/dataforseo/client";
import { PaidForbiddenError } from "@/ext/access/paid-guard";
import { isConfigured, getSettings } from "@/ext/dataforseo/config";
import * as dfs from "@/ext/dataforseo/service";
import { resolveMarket, marketForClient } from "@/ext/dataforseo/market";
import { getKeywordOverview, type DifficultyInfo, type IntentInfo } from "@/ext/providers/keyword-overview";
import type { DomainCompetitor, DomainOverview, KeywordIdea, RankedKeyword, RelevantPage } from "@/ext/dataforseo/endpoints/labs";
import type { BacklinkSummary } from "@/ext/dataforseo/endpoints/backlinks";
import { DOMAIN_LIMITS, estimateDomainMissing, estimateKeywordMissing, type Missing } from "@/ext/ui/research-estimates";

export type Slice<T> =
  | { status: "ready"; data: T; cached: boolean; fetchedAt: string }
  | { status: "miss" }
  | { status: "error"; error: string };

export type IdeasList = { total: number; items: KeywordIdea[] };

export type KeywordView = {
  keyword: string;
  country: string;
  configured: boolean;
  metrics: {
    volume: number | null;
    volumeBucket?: string;
    cpc: number | null;
    competition: number | null;
    trend: number[] | null;
    source: string;
    fetchedAt: string;
    cached: boolean;
    pending?: boolean;
  } | null;
  /** Set while a standard-queue volume task is pending: link to its page. */
  pendingRequestId?: number;
  difficulty: DifficultyInfo;
  intent: IntentInfo;
  suggestions: Slice<IdeasList>;
  related: Slice<IdeasList>;
  missing: Missing;
};

export type DomainView = {
  domain: string;
  country: string;
  configured: boolean;
  overview: Slice<DomainOverview>;
  pages: Slice<{ total: number; items: RelevantPage[] }>;
  keywords: Slice<{ total: number; items: RankedKeyword[] }>;
  competitors: Slice<{ total: number; items: DomainCompetitor[] }>;
  backlinks: Slice<BacklinkSummary | null> | null;
  missing: Missing;
};

const iso = (d: Date) => d.toISOString();

function mustThrow(e: unknown): boolean {
  return (
    e instanceof BudgetError ||
    e instanceof PaidForbiddenError ||
    (e instanceof DataForSeoError && (isAuthOrFundsError(e) || e.ambiguous))
  );
}

/** Wraps one service call: cache miss and per-part failures become slice states; spend-blocking errors still throw. */
async function slice<T>(spend: boolean, run: () => Promise<dfs.LiveResult<T>>): Promise<Slice<T>> {
  try {
    const r = await run();
    if (r.status === "cache_miss") return { status: "miss" };
    return { status: "ready", data: r.data, cached: r.cached, fetchedAt: iso(r.fetchedAt) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A domain this client has not looked up yet is simply "not cached" for cache-only readers.
    if (!spend && /Cached data is only readable/.test(msg)) return { status: "miss" };
    if (spend && mustThrow(e)) throw e;
    if (!spend) return { status: "miss" };
    return { status: "error", error: msg };
  }
}

async function marketFor(clientId: number, country: string | null | undefined) {
  const m = country ? resolveMarket(country, null) : await marketForClient(clientId);
  if (!m) throw new Error(`Unsupported country "${country ?? ""}": no DataForSEO location is known for it.`);
  return m;
}

export async function loadKeywordView(opts: { clientId: number; keyword: string; country?: string | null; spend: boolean }): Promise<KeywordView> {
  const { clientId, spend } = opts;
  const m = await marketFor(clientId, opts.country);
  const keyword = opts.keyword.trim().toLowerCase().replace(/\s+/g, " ");
  const market = { locationCode: m.locationCode, languageCode: m.languageCode, country: m.country, language: m.language };
  const loc = { location_code: m.locationCode, language_code: m.languageCode };
  const [configured, settings] = await Promise.all([isConfigured(), getSettings()]);

  const o = await getKeywordOverview({ clientId, keyword, market, allowSpend: spend });
  const metrics = o.metrics
    ? { ...o.metrics, fetchedAt: iso(o.metrics.fetchedAt) }
    : null;
  const suggestions = configured
    ? await slice(spend, () => dfs.keywordIdeas({ clientId, seeds: [keyword], variant: "suggestions", cacheOnly: !spend, ...loc }))
    : ({ status: "miss" } as const);
  const related = configured
    ? await slice(spend, () => dfs.keywordIdeas({ clientId, seeds: [keyword], variant: "ideas", cacheOnly: !spend, ...loc }))
    : ({ status: "miss" } as const);

  const missing = configured
    ? estimateKeywordMissing({
        mode: settings.defaultMode,
        haveVolume: metrics?.source === "dataforseo" && !o.requestId,
        haveDifficulty: o.difficulty.source === "dataforseo",
        haveIntent: !!o.intent.intent,
        haveSuggestions: suggestions.status === "ready",
        haveRelated: related.status === "ready",
      })
    : { micros: 0, parts: [] };

  return {
    keyword, country: m.country, configured, metrics,
    pendingRequestId: o.metricsStatus === "pending" ? o.requestId : undefined,
    difficulty: o.difficulty, intent: o.intent, suggestions, related, missing,
  };
}

export async function loadIdeas(opts: { clientId: number; seed: string; variant: "ideas" | "suggestions"; country?: string | null; spend: boolean }) {
  const m = await marketFor(opts.clientId, opts.country);
  return slice(opts.spend, () =>
    dfs.keywordIdeas({
      clientId: opts.clientId, seeds: [opts.seed], variant: opts.variant, cacheOnly: !opts.spend,
      location_code: m.locationCode, language_code: m.languageCode,
    }),
  );
}

export async function loadDomainView(opts: { clientId: number; domain: string; country?: string | null; spend: boolean }): Promise<DomainView> {
  const { clientId, spend } = opts;
  const m = await marketFor(clientId, opts.country);
  const loc = { location_code: m.locationCode, language_code: m.languageCode };
  const target = opts.domain;
  const [configured, settings] = await Promise.all([isConfigured(), getSettings()]);
  const co = { clientId, target, cacheOnly: !spend, ...loc };
  const miss = { status: "miss" } as const;

  const overview = configured ? await slice(spend, () => dfs.domainOverview(co)) : miss;
  const pages = configured ? await slice(spend, () => dfs.topPages({ ...co, limit: DOMAIN_LIMITS.pages })) : miss;
  const keywords = configured ? await slice(spend, () => dfs.rankedKeywords({ ...co, limit: DOMAIN_LIMITS.keywords })) : miss;
  const competitors = configured ? await slice(spend, () => dfs.domainCompetitors({ ...co, limit: DOMAIN_LIMITS.competitors })) : miss;
  // The backlinks summary is a separate subscription: shown from cache only, never bought here.
  const backlinks =
    configured && settings.backlinksEnabled ? await slice(false, () => dfs.backlinksSummary({ clientId, target, cacheOnly: true })) : null;

  const missing = configured
    ? estimateDomainMissing({
        haveOverview: overview.status === "ready",
        havePages: pages.status === "ready",
        haveKeywords: keywords.status === "ready",
        haveCompetitors: competitors.status === "ready",
      })
    : { micros: 0, parts: [] };
  return { domain: target, country: m.country, configured, overview, pages, keywords, competitors, backlinks, missing };
}
