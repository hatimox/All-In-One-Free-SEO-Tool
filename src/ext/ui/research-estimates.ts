/**
 * What "Get full data" would cost for the parts not yet cached. Pure; the
 * numbers are the same upper-bound estimates the budget uses, never a promise.
 */
import { DEFAULT_ROW_LIMIT, estimateMicros, type Mode } from "../dataforseo/pricing";

export type Missing = { micros: number; parts: string[] };

export function estimateKeywordMissing(a: {
  mode: Mode;
  haveVolume: boolean;
  haveDifficulty: boolean;
  haveIntent: boolean;
  haveSuggestions: boolean;
  haveRelated: boolean;
}): Missing {
  let micros = 0;
  const parts: string[] = [];
  const add = (label: string, m: number) => {
    micros += m;
    parts.push(label);
  };
  if (!a.haveVolume) add("volume", estimateMicros("search_volume", a.mode, 1));
  if (!a.haveDifficulty) add("difficulty", estimateMicros("labs_bulk_difficulty", "live", 1));
  if (!a.haveIntent) add("intent", estimateMicros("labs_search_intent", "live", 1));
  if (!a.haveSuggestions) add("suggestions", estimateMicros("labs_keyword_suggestions", "live", DEFAULT_ROW_LIMIT));
  if (!a.haveRelated) add("related ideas", estimateMicros("labs_keyword_ideas", "live", DEFAULT_ROW_LIMIT));
  return { micros, parts };
}

export const DOMAIN_LIMITS = { keywords: 100, pages: 50, competitors: 20 } as const;

export function estimateDomainMissing(a: { haveOverview: boolean; havePages: boolean; haveKeywords: boolean; haveCompetitors: boolean }): Missing {
  let micros = 0;
  const parts: string[] = [];
  const add = (label: string, m: number) => {
    micros += m;
    parts.push(label);
  };
  if (!a.haveOverview) add("overview", estimateMicros("labs_domain_overview", "live", 1));
  if (!a.havePages) add("top pages", estimateMicros("labs_relevant_pages", "live", DOMAIN_LIMITS.pages));
  if (!a.haveKeywords) add("top keywords", estimateMicros("labs_ranked_keywords", "live", DOMAIN_LIMITS.keywords));
  if (!a.haveCompetitors) add("competitors", estimateMicros("labs_competitors_domain", "live", DOMAIN_LIMITS.competitors));
  return { micros, parts };
}
