/**
 * Read helpers for the spend screens (Settings → DataForSEO, /account/spend).
 * Server-only. Everything returned is plain data.
 */
import { sqlite, db } from "@/db/client";
import { clients, users } from "@/db/schema";
import { monthlySpend, type MonthlySpend } from "../dataforseo/budget";
import { microsToUsd } from "../dataforseo/pricing";

export type LedgerView = {
  id: number;
  at: number;
  userId: number | null;
  clientId: number | null;
  endpoint: string;
  mode: string;
  status: string;
  cacheHit: boolean;
  micros: number;
};

/** Newest ledger rows, optionally for one user. Cost = actual when settled, else estimate. */
export function recentLedger(opts: { limit?: number; userId?: number | null } = {}): LedgerView[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const hasUser = opts.userId !== undefined && opts.userId !== null;
  const rows = sqlite
    .prepare(
      `SELECT id, created_at AS at, user_id AS userId, client_id AS clientId, endpoint, mode, status,
              cache_hit AS cacheHit,
              CASE WHEN status='settled' THEN COALESCE(actual_cost_micros,0)
                   WHEN status='reserved' THEN estimated_cost_micros ELSE 0 END AS micros
       FROM ext_dfs_ledger ${hasUser ? "WHERE user_id = ?" : ""} ORDER BY id DESC LIMIT ?`,
    )
    .all(...(hasUser ? [opts.userId, limit] : [limit])) as (Omit<LedgerView, "cacheHit"> & { cacheHit: number })[];
  return rows.map((r) => ({ ...r, cacheHit: r.cacheHit === 1 }));
}

export function nameMaps(): { users: Map<number, string>; clients: Map<number, string> } {
  const u = new Map<number, string>();
  for (const r of db.select({ id: users.id, name: users.name, email: users.email }).from(users).all()) {
    u.set(r.id, r.name || r.email);
  }
  const c = new Map<number, string>();
  for (const r of db.select({ id: clients.id, name: clients.name }).from(clients).all()) c.set(r.id, r.name);
  return { users: u, clients: c };
}

export type SpendOverview = { spend: MonthlySpend; ledger: LedgerView[] };

export function spendOverview(opts: { userId?: number | null; ledgerLimit?: number } = {}): SpendOverview {
  const q = opts.userId === undefined ? {} : { userId: opts.userId };
  return { spend: monthlySpend(q), ledger: recentLedger({ limit: opts.ledgerLimit ?? 50, userId: opts.userId }) };
}

export const usd = (micros: number, digits = 2) => "$" + microsToUsd(micros).toFixed(digits);
