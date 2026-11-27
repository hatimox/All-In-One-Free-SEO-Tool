/**
 * DataForSEO Labs (Google)
 * Docs: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live/
 *       https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/
 *       https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/
 *
 * - keyword_ideas/live: `keywords` (<=200 seeds), limit default 700 max 1000
 * - keyword_suggestions/live: single `keyword`, limit default 100 max 1000
 * - ranked_keywords/live: `target` (domain), limit default 100 max 1000
 * All: one task per live call, result[0].items[], billed per request + per item.
 */
import { dfsLive, type DfsTask } from "../client";

export type KeywordIdea = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  trend: number[] | null;
};

export type RankedKeyword = {
  keyword: string;
  volume: number | null;
  position: number | null;
  url: string | null;
  etv: number | null;
  difficulty: number | null;
};

type KI = {
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
};
type RawIdea = {
  keyword?: string;
  keyword_info?: KI | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
};
type RawRanked = {
  keyword_data?: RawIdea | null;
  ranked_serp_element?: {
    serp_item?: { rank_absolute?: number | null; rank_group?: number | null; url?: string | null; etv?: number | null } | null;
  } | null;
};
type LabsResult<I> = { total_count?: number; items_count?: number; items?: I[] | null };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function trendOf(ki?: KI | null): number[] | null {
  const m = (ki?.monthly_searches ?? [])
    .slice()
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-12)
    .map((x) => x.search_volume ?? 0);
  return m.length ? m : null;
}

export function mapIdea(r: RawIdea): KeywordIdea | null {
  if (!r || typeof r.keyword !== "string") return null;
  const ki = r.keyword_info;
  return {
    keyword: r.keyword.trim().toLowerCase(),
    volume: num(ki?.search_volume),
    cpc: num(ki?.cpc),
    competition: num(ki?.competition),
    difficulty: num(r.keyword_properties?.keyword_difficulty),
    intent: r.search_intent_info?.main_intent ?? null,
    trend: trendOf(ki),
  };
}

/** Works for keyword_ideas and keyword_suggestions (all result elements are scanned). */
export function mapIdeasResult(task: DfsTask<LabsResult<RawIdea>>): { total: number; items: KeywordIdea[] } {
  const items: KeywordIdea[] = [];
  let total = 0;
  for (const res of task.result ?? []) {
    total = Math.max(total, res?.total_count ?? 0);
    for (const it of res?.items ?? []) {
      const m = mapIdea(it);
      if (m) items.push(m);
    }
  }
  return { total, items };
}

export function mapRankedResult(task: DfsTask<LabsResult<RawRanked>>): { total: number; items: RankedKeyword[] } {
  const items: RankedKeyword[] = [];
  let total = 0;
  for (const res of task.result ?? []) {
    total = Math.max(total, res?.total_count ?? 0);
    for (const it of res?.items ?? []) {
      const kd = it?.keyword_data;
      if (!kd || typeof kd.keyword !== "string") continue;
      const s = it.ranked_serp_element?.serp_item;
      items.push({
        keyword: kd.keyword.trim().toLowerCase(),
        volume: num(kd.keyword_info?.search_volume),
        position: num(s?.rank_absolute ?? s?.rank_group),
        url: s?.url ?? null,
        etv: num(s?.etv),
        difficulty: num(kd.keyword_properties?.keyword_difficulty),
      });
    }
  }
  return { total, items };
}

type Market = { locationCode: number; languageCode: string };

export async function keywordIdeasLive(p: Market & { keywords: string[]; limit: number }) {
  const t = await dfsLive<LabsResult<RawIdea>>("/v3/dataforseo_labs/google/keyword_ideas/live", {
    keywords: p.keywords.slice(0, 200),
    location_code: p.locationCode,
    language_code: p.languageCode,
    limit: Math.min(p.limit, 1000),
  });
  return { ...mapIdeasResult(t), costUsd: t.cost ?? 0 };
}

export async function keywordSuggestionsLive(p: Market & { keyword: string; limit: number }) {
  const t = await dfsLive<LabsResult<RawIdea>>("/v3/dataforseo_labs/google/keyword_suggestions/live", {
    keyword: p.keyword,
    location_code: p.locationCode,
    language_code: p.languageCode,
    limit: Math.min(p.limit, 1000),
  });
  return { ...mapIdeasResult(t), costUsd: t.cost ?? 0 };
}

export async function rankedKeywordsLive(p: Market & { target: string; limit: number }) {
  const t = await dfsLive<LabsResult<RawRanked>>("/v3/dataforseo_labs/google/ranked_keywords/live", {
    target: p.target,
    location_code: p.locationCode,
    language_code: p.languageCode,
    limit: Math.min(p.limit, 1000),
  });
  return { ...mapRankedResult(t), costUsd: t.cost ?? 0 };
}

// ---------------------------------------------------------------------------
// Keyword difficulty, intent and domain-level endpoints
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/
//       https://docs.dataforseo.com/v3/dataforseo_labs/google/search_intent/live/
//       https://docs.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live/
//       https://docs.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live/
//       https://docs.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live/
// ---------------------------------------------------------------------------

/** bulk_keyword_difficulty and search_intent accept at most 1000 keywords per task. */
export const BULK_KEYWORDS_MAX = 1000;

export type KeywordDifficultyRow = { keyword: string; difficulty: number | null };
export type KeywordIntentRow = {
  keyword: string;
  intent: string | null;
  probability: number | null;
  secondary: { intent: string; probability: number | null }[];
};
export type PositionBuckets = { pos1: number; pos2_3: number; pos4_10: number; pos11_20: number; pos21_50: number; pos51_100: number };
export type DomainOverview = {
  target: string;
  organicKeywords: number | null;
  etv: number | null;
  positions: PositionBuckets | null;
};
export type RelevantPage = { url: string; etv: number | null; keywords: number | null };
export type DomainCompetitor = { domain: string; intersections: number | null; etv: number | null; keywords: number | null };

const lower = (s: string) => s.trim().toLowerCase();

export function mapDifficultyResult(task: DfsTask<LabsResult<{ keyword?: string; keyword_difficulty?: number | null }>>): KeywordDifficultyRow[] {
  const out: KeywordDifficultyRow[] = [];
  for (const res of task.result ?? []) {
    for (const it of res?.items ?? []) {
      if (typeof it?.keyword !== "string") continue;
      out.push({ keyword: lower(it.keyword), difficulty: num(it.keyword_difficulty) });
    }
  }
  return out;
}

type RawIntent = { label?: string | null; probability?: number | null };
export function mapIntentResult(
  task: DfsTask<LabsResult<{ keyword?: string; keyword_intent?: RawIntent | null; secondary_keyword_intents?: RawIntent[] | null }>>,
): KeywordIntentRow[] {
  const out: KeywordIntentRow[] = [];
  for (const res of task.result ?? []) {
    for (const it of res?.items ?? []) {
      if (typeof it?.keyword !== "string") continue;
      out.push({
        keyword: lower(it.keyword),
        intent: it.keyword_intent?.label ?? null,
        probability: num(it.keyword_intent?.probability),
        secondary: (it.secondary_keyword_intents ?? [])
          .filter((s): s is RawIntent & { label: string } => typeof s?.label === "string")
          .map((s) => ({ intent: s.label, probability: num(s.probability) })),
      });
    }
  }
  return out;
}

type RawOrganic = Record<string, number | null | undefined> | null | undefined;
const sum = (o: RawOrganic, keys: string[]) => keys.reduce((a, k) => a + (num(o?.[k]) ?? 0), 0);

export function mapDomainOverviewResult(task: DfsTask<LabsResult<{ metrics?: { organic?: RawOrganic } | null }> & { target?: string }>, target: string): DomainOverview {
  const items = (task.result ?? []).flatMap((r) => r?.items ?? []);
  const o = items.find((i) => i?.metrics?.organic)?.metrics?.organic;
  if (!o) return { target, organicKeywords: null, etv: null, positions: null };
  return {
    target,
    organicKeywords: num(o.count),
    etv: num(o.etv),
    positions: {
      pos1: sum(o, ["pos_1"]),
      pos2_3: sum(o, ["pos_2_3"]),
      pos4_10: sum(o, ["pos_4_10"]),
      pos11_20: sum(o, ["pos_11_20"]),
      pos21_50: sum(o, ["pos_21_30", "pos_31_40", "pos_41_50"]),
      pos51_100: sum(o, ["pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"]),
    },
  };
}

export function mapRelevantPagesResult(
  task: DfsTask<LabsResult<{ page_address?: string; metrics?: { organic?: RawOrganic } | null }>>,
): { total: number; items: RelevantPage[] } {
  const items: RelevantPage[] = [];
  let total = 0;
  for (const res of task.result ?? []) {
    total = Math.max(total, res?.total_count ?? 0);
    for (const it of res?.items ?? []) {
      if (typeof it?.page_address !== "string") continue;
      items.push({ url: it.page_address, etv: num(it.metrics?.organic?.etv), keywords: num(it.metrics?.organic?.count) });
    }
  }
  return { total, items };
}

export function mapCompetitorsResult(
  task: DfsTask<LabsResult<{ domain?: string; intersections?: number | null; full_domain_metrics?: { organic?: RawOrganic } | null; metrics?: { organic?: RawOrganic } | null }>>,
): { total: number; items: DomainCompetitor[] } {
  const items: DomainCompetitor[] = [];
  let total = 0;
  for (const res of task.result ?? []) {
    total = Math.max(total, res?.total_count ?? 0);
    for (const it of res?.items ?? []) {
      if (typeof it?.domain !== "string") continue;
      items.push({
        domain: it.domain.toLowerCase(),
        intersections: num(it.intersections),
        etv: num(it.full_domain_metrics?.organic?.etv),
        keywords: num(it.full_domain_metrics?.organic?.count),
      });
    }
  }
  return { total, items };
}

export async function bulkDifficultyLive(p: Market & { keywords: string[] }) {
  const t = await dfsLive<LabsResult<{ keyword?: string; keyword_difficulty?: number | null }>>(
    "/v3/dataforseo_labs/google/bulk_keyword_difficulty/live",
    { keywords: p.keywords.slice(0, BULK_KEYWORDS_MAX), location_code: p.locationCode, language_code: p.languageCode },
  );
  return { rows: mapDifficultyResult(t), costUsd: t.cost ?? 0 };
}

export async function searchIntentLive(p: { keywords: string[]; languageCode: string }) {
  // search_intent takes a language only (no location).
  const t = await dfsLive<Parameters<typeof mapIntentResult>[0] extends DfsTask<infer R> ? R : never>(
    "/v3/dataforseo_labs/google/search_intent/live",
    { keywords: p.keywords.slice(0, BULK_KEYWORDS_MAX), language_code: p.languageCode },
  );
  return { rows: mapIntentResult(t), costUsd: t.cost ?? 0 };
}

export async function domainOverviewLive(p: Market & { target: string }) {
  const t = await dfsLive<Parameters<typeof mapDomainOverviewResult>[0] extends DfsTask<infer R> ? R : never>(
    "/v3/dataforseo_labs/google/domain_rank_overview/live",
    { target: p.target, location_code: p.locationCode, language_code: p.languageCode, limit: 1 },
  );
  return { overview: mapDomainOverviewResult(t, p.target), costUsd: t.cost ?? 0 };
}

export async function relevantPagesLive(p: Market & { target: string; limit: number }) {
  const t = await dfsLive<Parameters<typeof mapRelevantPagesResult>[0] extends DfsTask<infer R> ? R : never>(
    "/v3/dataforseo_labs/google/relevant_pages/live",
    {
      target: p.target, location_code: p.locationCode, language_code: p.languageCode,
      limit: Math.min(p.limit, 1000), item_types: ["organic"], order_by: ["metrics.organic.etv,desc"],
    },
  );
  return { ...mapRelevantPagesResult(t), costUsd: t.cost ?? 0 };
}

export async function competitorsDomainLive(p: Market & { target: string; limit: number }) {
  const t = await dfsLive<Parameters<typeof mapCompetitorsResult>[0] extends DfsTask<infer R> ? R : never>(
    "/v3/dataforseo_labs/google/competitors_domain/live",
    { target: p.target, location_code: p.locationCode, language_code: p.languageCode, limit: Math.min(p.limit, 1000), item_types: ["organic"] },
  );
  return { ...mapCompetitorsResult(t), costUsd: t.cost ?? 0 };
}
