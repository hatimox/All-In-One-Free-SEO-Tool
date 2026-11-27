/**
 * Pure label/tooltip logic for SourceBadge, kept free of React so it can be
 * unit-tested and reused by server actions.
 */
import { DATA_SOURCES, isDataSource, sourceProvenance } from "../providers/sources";

const BADGE_LABELS = {
  dataforseo: "DataForSEO",
  google_ads: "Keyword Planner",
  bing: "Bing impressions",
  estimate: "Estimate (relative)",
  gsc: "Search Console",
} as const;

export function sourceBadgeLabel(source: string): string {
  return isDataSource(source) ? BADGE_LABELS[source] : source;
}

export function sourceBadgeTitle(o: {
  source: string;
  fetchedAt?: Date | string | null;
  cached?: boolean;
  fallbackReason?: string | null;
  pending?: boolean;
}): string {
  const parts = [sourceProvenance(o.source).replace(/^./, (c) => c.toUpperCase()) + "."];
  if (o.fetchedAt) {
    const d = new Date(o.fetchedAt);
    if (!Number.isNaN(d.getTime())) parts.push(`As of ${d.toISOString().slice(0, 10)}.`);
  }
  if (o.cached) parts.push("Cached: served from a previous lookup, no new spend.");
  if (o.pending) parts.push("Provisional: exact figures are still in the DataForSEO queue.");
  if (o.fallbackReason) parts.push(`Why not DataForSEO: ${o.fallbackReason}.`);
  return parts.join(" ");
}

export function isKnownSource(s: string): boolean {
  return s in DATA_SOURCES;
}
