/**
 * Recent DataForSEO lookups of one client, read from ext_dfs_requests.
 * Never returns another client's rows; guardRead checks the caller may see
 * the client first.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { extDfsRequests } from "../db/schema";
import { guardRead } from "../access/paid-guard";

export type RecentSearch = {
  kind: (typeof extDfsRequests.$inferSelect)["kind"];
  query?: string;
  target?: string;
  market: { locationCode: number; languageCode: string } | null;
  createdAt: Date;
  status: "pending" | "ready" | "failed";
  requestId: number;
};

type Params = {
  keywords?: string[];
  seeds?: string[];
  target?: string;
  competitors?: string[];
  locationCode?: number;
  languageCode?: string;
};

/** Newest first, de-duplicated by kind + query/target + market. */
export async function recentSearches(opts: { clientId: number; limit?: number }): Promise<RecentSearch[]> {
  await guardRead(opts.clientId);
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  const rows = db
    .select()
    .from(extDfsRequests)
    .where(eq(extDfsRequests.clientId, opts.clientId))
    .orderBy(desc(extDfsRequests.createdAt), desc(extDfsRequests.id))
    .all();
  const seen = new Set<string>();
  const out: RecentSearch[] = [];
  for (const r of rows) {
    let p: Params;
    try {
      p = JSON.parse(r.paramsJson) as Params;
    } catch {
      continue;
    }
    const list = p.keywords ?? p.seeds;
    const query = list?.length ? list.join(", ") : undefined;
    const target = p.target;
    if (!query && !target) continue;
    const market = p.locationCode && p.languageCode ? { locationCode: p.locationCode, languageCode: p.languageCode } : null;
    const key = [r.kind, query ?? target, market?.locationCode ?? "", market?.languageCode ?? p.languageCode ?? ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: r.kind, ...(query ? { query } : {}), ...(target ? { target } : {}),
      market, createdAt: r.createdAt, status: r.status, requestId: r.id,
    });
    if (out.length >= limit) break;
  }
  return out;
}
