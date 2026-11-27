/**
 * Backlink data provider: DataForSEO when enabled + configured (summary and
 * referring domains, cacheOnly unless allowSpend), otherwise
 * `{source:"none", fallback:"discovery"}` so the UI can offer the existing
 * (slow) DDG discovery crawl. This function never runs that crawl.
 */
import { getSettings, isConfigured } from "../dataforseo/config";
import * as dfs from "../dataforseo/service";

export type BacklinkOverview =
  | {
      source: "dataforseo";
      status: "ready";
      cached: boolean;
      summary: Awaited<ReturnType<typeof import("../dataforseo/endpoints/backlinks").summaryLive>>["summary"];
      referringDomains: unknown[] | null;
    }
  | { source: "dataforseo"; status: "cache_miss" }
  | { source: "none"; fallback: "discovery"; reason: string };

export async function getBacklinkOverview(opts: {
  clientId: number;
  target?: string;
  allowSpend: boolean;
}): Promise<BacklinkOverview> {
  if (!(await getSettings()).backlinksEnabled) {
    return { source: "none", fallback: "discovery", reason: "DataForSEO backlinks are switched off" };
  }
  if (!(await isConfigured())) {
    return { source: "none", fallback: "discovery", reason: "DataForSEO is not configured" };
  }
  try {
    const s = await dfs.backlinksSummary({ clientId: opts.clientId, target: opts.target, cacheOnly: !opts.allowSpend });
    if (s.status === "cache_miss") return { source: "dataforseo", status: "cache_miss" };
    const r = await dfs.referringDomains({ clientId: opts.clientId, target: opts.target, cacheOnly: !opts.allowSpend, limit: 100 });
    return {
      source: "dataforseo",
      status: "ready",
      cached: s.cached && (r.status === "ready" ? r.cached : true),
      summary: s.data,
      referringDomains: r.status === "ready" ? (r.data as { items: unknown[] }).items : null,
    };
  } catch (e) {
    return { source: "none", fallback: "discovery", reason: `DataForSEO unavailable: ${(e as Error).message}` };
  }
}
