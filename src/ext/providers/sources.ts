/**
 * Where a keyword number can come from, and what each source IS.
 * Modeled on src/lib/serp/sources.ts: these sources measure different
 * things, so the UI shows `provenance` beside any number.
 */
export const DATA_SOURCES = {
  dataforseo: {
    label: "DataForSEO",
    short: "DFS",
    provenance:
      "DataForSEO (Google Ads Keyword Planner data) — average monthly searches for the exact keyword in the client's market, a paid lookup cached for days",
  },
  google_ads: {
    label: "Google Keyword Planner",
    short: "Ads",
    provenance:
      "Google Ads Keyword Planner via your connected account — exact figures if the account spends, otherwise the lower bound of a volume range",
  },
  bing: {
    label: "Bing Webmaster",
    short: "Bing",
    provenance:
      "Bing impressions for the term over 30 days — far below Google's absolute numbers; sound for ordering keywords, not for forecasting traffic",
  },
  estimate: {
    label: "Free estimate",
    short: "Est.",
    provenance:
      "a relative bucket guessed from Google Trends and autocomplete signals — directional only, not a search count",
  },
  gsc: {
    label: "Search Console",
    short: "GSC",
    provenance:
      "Google Search Console impressions for your own site — real searches, but only for queries where you already appeared",
  },
} as const;

export type DataSource = keyof typeof DATA_SOURCES;

export const DATA_SOURCE_IDS = Object.keys(DATA_SOURCES) as [DataSource, ...DataSource[]];

export function isDataSource(v: unknown): v is DataSource {
  return typeof v === "string" && v in DATA_SOURCES;
}

export function sourceLabel(s: string): string {
  return isDataSource(s) ? DATA_SOURCES[s].label : s;
}

export function sourceShortLabel(s: string): string {
  return isDataSource(s) ? DATA_SOURCES[s].short : s;
}

export function sourceProvenance(s: string): string {
  return isDataSource(s)
    ? DATA_SOURCES[s].provenance
    : `unrecognised source "${s}" — treat this number as unverified`;
}
