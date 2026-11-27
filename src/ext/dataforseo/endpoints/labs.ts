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
