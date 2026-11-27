/**
 * Pre-call COST ESTIMATES, used only to reserve budget before a request.
 * The real cost always comes from tasks[].cost in the response and is what
 * the ledger settles to.
 *
 * Prices verified 2026-11-27 (re-check before relying on them):
 *   https://dataforseo.com/pricing
 *   https://dataforseo.com/pricing/keywords-data/google-ads
 *   https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api
 *   https://dataforseo.com/pricing/backlinks/backlinks
 *   https://docs.dataforseo.com/v3/appendix/errors/
 * Edit PRICES below when they change; nothing else hardcodes a price.
 *
 * Google Ads search_volume is billed PER TASK (up to 1000 keywords each),
 * so `units` for it means tasks, never keywords. Labs/Backlinks are billed
 * per request plus per returned row, so `units` is the requested `limit`.
 */
export type EndpointId =
  | "search_volume"
  | "labs_keyword_ideas"
  | "labs_keyword_suggestions"
  | "labs_ranked_keywords"
  | "labs_bulk_difficulty"
  | "labs_search_intent"
  | "labs_domain_overview"
  | "labs_relevant_pages"
  | "labs_competitors_domain"
  | "backlinks_summary"
  | "backlinks_list"
  | "backlinks_referring_domains"
  | "backlinks_domain_intersection"
  | "user_data";

export type Mode = "live" | "standard";

export const PRICES = {
  search_volume: { standard: 0.06, live: 0.09 }, // USD per task
  // General Labs (Google) live rate: $0.012 per task + $0.00012 per returned item/keyword.
  // Source: https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api (verified 2026-11-27).
  // Per endpoint, using this general rate (none is on that page's exceptions list):
  //   labs_search_intent      (search_intent/live, <=1000 keywords)   - listed on the page at the general rate
  //   labs_bulk_difficulty    (bulk_keyword_difficulty/live)          - unconfirmed: general rate assumed
  //   labs_domain_overview    (domain_rank_overview/live)             - unconfirmed: general rate assumed
  //   labs_relevant_pages     (relevant_pages/live)                   - unconfirmed: general rate assumed
  //   labs_competitors_domain (competitors_domain/live)               - unconfirmed: general rate assumed
  // Real cost always comes from the response; this is only the reservation estimate.
  labs: { perRequest: 0.012, perItem: 0.00012 },
  backlinks: { perRequest: 0.024, perRow: 0.000036 },
} as const;

/** Max keywords Google Ads accepts per task. */
export const VOLUME_KEYWORDS_PER_TASK = 1000;
/** Default row limit for Labs/Backlinks calls so estimates stay small. */
export const DEFAULT_ROW_LIMIT = 200;

export function tasksForKeywords(n: number): number {
  return Math.max(1, Math.ceil(n / VOLUME_KEYWORDS_PER_TASK));
}

/** Estimated cost in micro-USD, rounded UP. */
export function estimateMicros(endpoint: EndpointId, mode: Mode, units: number): number {
  const u = Math.max(1, Math.ceil(units));
  let usd: number;
  switch (endpoint) {
    case "search_volume":
      usd = PRICES.search_volume[mode] * u;
      break;
    case "labs_keyword_ideas":
    case "labs_keyword_suggestions":
    case "labs_ranked_keywords":
    case "labs_bulk_difficulty":
    case "labs_search_intent":
    case "labs_domain_overview":
    case "labs_relevant_pages":
    case "labs_competitors_domain":
      usd = PRICES.labs.perRequest + PRICES.labs.perItem * u;
      break;
    case "backlinks_summary":
      usd = PRICES.backlinks.perRequest + PRICES.backlinks.perRow;
      break;
    case "backlinks_list":
    case "backlinks_referring_domains":
    case "backlinks_domain_intersection":
      usd = PRICES.backlinks.perRequest + PRICES.backlinks.perRow * u;
      break;
    case "user_data":
      return 0;
  }
  return Math.ceil(usd * 1_000_000 - 1e-6);
}

export const microsToUsd = (m: number) => m / 1_000_000;
export const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);
