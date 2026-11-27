/**
 * Backlinks API
 * Docs: https://docs.dataforseo.com/v3/backlinks/summary/live/
 *       https://docs.dataforseo.com/v3/backlinks/backlinks/live/
 *       https://docs.dataforseo.com/v3/backlinks/referring_domains/live/
 *       https://docs.dataforseo.com/v3/backlinks/domain_intersection/live/
 *
 * Domains are passed WITHOUT scheme or www; page targets need an absolute URL.
 * domain_intersection: competitors go in `targets` ({"1":..,"2":..}) and the
 * client's own domain in `exclude_targets`, giving domains that link to the
 * competitors but NOT to the client.
 * NOTE: the docs do not state whether the Backlinks API needs a separate
 * subscription; that is unconfirmed, hence `backlinks_enabled` defaults off.
 */
import { dfsLive, type DfsTask } from "../client";

export type BacklinkSummary = {
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  brokenBacklinks: number | null;
  rank: number | null;
  spamScore: number | null;
};
export type Backlink = {
  urlFrom: string;
  urlTo: string | null;
  domainFrom: string | null;
  anchor: string | null;
  dofollow: boolean | null;
  rank: number | null;
  firstSeen: string | null;
  isLost: boolean;
};
export type ReferringDomain = {
  domain: string;
  backlinks: number | null;
  rank: number | null;
  firstSeen: string | null;
  spamScore: number | null;
};
export type GapDomain = {
  domain: string;
  /** How many of the competitor targets this domain links to. */
  intersections: number;
  /** Strongest rank across competitors it links to. */
  rank: number | null;
  backlinks: number | null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** DFS wants bare domains: strip scheme, www, path. */
export function bareDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

type RawSummary = Record<string, unknown>;
export function mapSummary(task: DfsTask<RawSummary>): BacklinkSummary | null {
  const r = task.result?.[0];
  if (!r) return null;
  return {
    backlinks: num(r.backlinks),
    referringDomains: num(r.referring_domains),
    referringPages: num(r.referring_pages),
    brokenBacklinks: num(r.broken_backlinks),
    rank: num(r.rank),
    spamScore: num(r.backlinks_spam_score),
  };
}

type RawItems = { total_count?: number; items?: Record<string, unknown>[] | null };

export function mapBacklinks(task: DfsTask<RawItems>): { total: number; items: Backlink[] } {
  const r = task.result?.[0];
  const items: Backlink[] = [];
  for (const it of r?.items ?? []) {
    if (typeof it.url_from !== "string") continue;
    items.push({
      urlFrom: it.url_from,
      urlTo: (it.url_to as string) ?? null,
      domainFrom: (it.domain_from as string) ?? null,
      anchor: (it.anchor as string) ?? null,
      dofollow: typeof it.dofollow === "boolean" ? it.dofollow : null,
      rank: num(it.rank),
      firstSeen: (it.first_seen as string) ?? null,
      isLost: it.is_lost === true,
    });
  }
  return { total: r?.total_count ?? items.length, items };
}

export function mapReferringDomains(task: DfsTask<RawItems>): { total: number; items: ReferringDomain[] } {
  const r = task.result?.[0];
  const items: ReferringDomain[] = [];
  for (const it of r?.items ?? []) {
    if (typeof it.domain !== "string") continue;
    items.push({
      domain: it.domain,
      backlinks: num(it.backlinks),
      rank: num(it.rank),
      firstSeen: (it.first_seen as string) ?? null,
      spamScore: num(it.backlinks_spam_score),
    });
  }
  return { total: r?.total_count ?? items.length, items };
}

export function mapIntersection(task: DfsTask<RawItems>): { total: number; items: GapDomain[] } {
  const r = task.result?.[0];
  const items: GapDomain[] = [];
  for (const it of r?.items ?? []) {
    const inter = it.domain_intersection as Record<string, Record<string, unknown>> | undefined;
    if (!inter) continue;
    const entries = Object.values(inter);
    const domain = entries.map((e) => e?.target).find((t): t is string => typeof t === "string");
    if (!domain) continue;
    const summary = it.summary as { intersections_count?: number } | undefined;
    const ranks = entries.map((e) => num(e?.rank)).filter((x): x is number => x !== null);
    const bl = entries.map((e) => num(e?.backlinks)).filter((x): x is number => x !== null);
    items.push({
      domain,
      intersections: summary?.intersections_count ?? entries.length,
      rank: ranks.length ? Math.max(...ranks) : null,
      backlinks: bl.length ? bl.reduce((a, b) => a + b, 0) : null,
    });
  }
  return { total: r?.total_count ?? items.length, items };
}

export async function summaryLive(target: string) {
  const t = await dfsLive<RawSummary>("/v3/backlinks/summary/live", {
    target: bareDomain(target),
    include_subdomains: true,
    exclude_internal_backlinks: true,
  });
  return { summary: mapSummary(t), costUsd: t.cost ?? 0 };
}

export async function backlinksLive(p: { target: string; limit: number }) {
  const t = await dfsLive<RawItems>("/v3/backlinks/backlinks/live", {
    target: bareDomain(p.target),
    mode: "one_per_domain",
    limit: Math.min(p.limit, 1000),
    order_by: ["rank,desc"],
  });
  return { ...mapBacklinks(t), costUsd: t.cost ?? 0 };
}

export async function referringDomainsLive(p: { target: string; limit: number }) {
  const t = await dfsLive<RawItems>("/v3/backlinks/referring_domains/live", {
    target: bareDomain(p.target),
    limit: Math.min(p.limit, 1000),
    order_by: ["rank,desc"],
  });
  return { ...mapReferringDomains(t), costUsd: t.cost ?? 0 };
}

export async function domainIntersectionLive(p: { competitors: string[]; exclude: string; limit: number }) {
  const targets: Record<string, string> = {};
  p.competitors.slice(0, 20).forEach((c, i) => (targets[String(i + 1)] = bareDomain(c)));
  const t = await dfsLive<RawItems>("/v3/backlinks/domain_intersection/live", {
    targets,
    exclude_targets: [bareDomain(p.exclude)],
    limit: Math.min(p.limit, 1000),
    order_by: ["1.rank,desc"],
  });
  return { ...mapIntersection(t), costUsd: t.cost ?? 0 };
}
