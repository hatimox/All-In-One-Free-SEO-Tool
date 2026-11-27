/** Recent searches shaped for the research pages (server only, cache-free: reads request rows). */
import { recentSearches, type RecentSearch } from "@/ext/dataforseo/history";
import { countryForLocation } from "@/ext/dataforseo/market";
import { researchHref } from "@/ext/ui/research-input";

export type RecentItem = {
  clientId: number;
  clientName?: string;
  type: "keyword" | "domain";
  label: string;
  country: string | null;
  href: string;
  at: string;
  /** True when the lookup that created it is still in the standard queue. */
  pending: boolean;
};

const SKIP = new Set<RecentSearch["kind"]>(["backlink_gap", "backlinks_summary", "backlinks_list", "referring_domains"]);

export function toRecentItem(clientId: number, r: RecentSearch, clientName?: string): RecentItem | null {
  if (SKIP.has(r.kind)) return null;
  const country = countryForLocation(r.market?.locationCode);
  if (r.target) {
    return {
      clientId, clientName, type: "domain", label: r.target, country, pending: false,
      href: researchHref(clientId, { type: "domain", value: r.target }, country), at: r.createdAt.toISOString(),
    };
  }
  const pendingHref = r.status === "pending" && r.kind === "volume" ? `/market-data/c/${clientId}/requests/${r.requestId}` : null;
  const first = (r.query ?? "").split(",")[0]?.trim();
  if (!first) return null;
  const href =
    pendingHref ??
    (r.kind === "ideas"
      ? `/market-data/c/${clientId}/ideas?q=${encodeURIComponent(first)}${country ? `&country=${country}` : ""}`
      : researchHref(clientId, { type: "keyword", value: first }, country));
  return { clientId, clientName, type: "keyword", label: first, country, href, at: r.createdAt.toISOString(), pending: r.status === "pending" };
}

/** Newest first, de-duplicated by what was searched, across the given clients. */
export async function loadRecent(clients: { id: number; name: string }[], limit = 12): Promise<RecentItem[]> {
  const out: RecentItem[] = [];
  for (const c of clients.slice(0, 25)) {
    try {
      for (const r of await recentSearches({ clientId: c.id, limit })) {
        const it = toRecentItem(c.id, r, c.name);
        if (it) out.push(it);
      }
    } catch {
      /* a client the caller may not read contributes nothing */
    }
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((i) => {
      const k = `${i.clientId}|${i.type}|${i.label}|${i.country}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, limit);
}
