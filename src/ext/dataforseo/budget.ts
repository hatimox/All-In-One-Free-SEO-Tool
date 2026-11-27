/**
 * Spend control for paid DataForSEO calls.
 *
 * `reserve()` is the only way to start a paid call. The check (sum of this
 * UTC month's reserved + settled costs vs caps) and the insert of the
 * `reserved` row happen inside ONE synchronous better-sqlite3 transaction
 * (BEGIN IMMEDIATE), with no await in between, so two concurrent reserves
 * can never both pass when only one fits (also across processes).
 *
 * Settled rows count at their ACTUAL cost (tasks[].cost); reserved rows
 * count at their estimate until settled or released.
 */
import { sqlite } from "@/db/client";
import { getSettings } from "./config";
import { estimateMicros, microsToUsd, type EndpointId, type Mode } from "./pricing";

export type BudgetScope = "team_unset" | "team" | "user" | "request";

export class BudgetError extends Error {
  readonly scope: BudgetScope;
  readonly spentUsd: number;
  readonly capUsd: number | null;
  constructor(message: string, scope: BudgetScope, spentUsd: number, capUsd: number | null) {
    super(message);
    this.name = "BudgetError";
    this.scope = scope;
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}

const usd = (micros: number) => "$" + microsToUsd(micros).toFixed(4);

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}
export function monthStartMs(d = new Date()): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export type ReserveInput = {
  userId: number | null;
  clientId: number | null;
  endpoint: EndpointId;
  mode: Mode;
  /** Tasks for search_volume, requested row limit for Labs/Backlinks. */
  units: number;
  requestId?: number | null;
  /** Overrides the pricing-table estimate (rare). */
  estimatedMicros?: number;
};

export type Reservation = { id: number; estimatedMicros: number };

const SPENT_SQL = `
  SELECT COALESCE(SUM(CASE WHEN status = 'settled' THEN COALESCE(actual_cost_micros, 0)
                           WHEN status = 'reserved' THEN estimated_cost_micros
                           ELSE 0 END), 0) AS micros
  FROM ext_dfs_ledger
  WHERE created_at >= ? AND status IN ('reserved','settled')`;

export async function reserve(input: ReserveInput): Promise<Reservation> {
  const settings = await getSettings(); // async work done BEFORE the transaction
  const est = input.estimatedMicros ?? estimateMicros(input.endpoint, input.mode, input.units);
  const start = monthStartMs();
  const now = Date.now();

  const tx = sqlite.transaction((): Reservation => {
    if (settings.teamCapUsd === null) {
      throw new BudgetError(
        "No DataForSEO team budget is set. Set a monthly cap in Settings before paid calls are allowed.",
        "team_unset",
        0,
        null,
      );
    }
    if (est > Math.round(settings.requestMaxUsd * 1_000_000)) {
      throw new BudgetError(
        "This request is estimated at " + usd(est) + ", above the per-request maximum of $" + settings.requestMaxUsd.toFixed(2) + ".",
        "request",
        0,
        settings.requestMaxUsd,
      );
    }
    const teamSpent = (sqlite.prepare(SPENT_SQL).get(start) as { micros: number }).micros;
    const teamCap = Math.round(settings.teamCapUsd * 1_000_000);
    if (teamSpent + est > teamCap) {
      throw new BudgetError(
        "Team DataForSEO budget reached: spent " + usd(teamSpent) + " of $" + settings.teamCapUsd.toFixed(2) + " this month (this call ~" + usd(est) + ").",
        "team",
        microsToUsd(teamSpent),
        settings.teamCapUsd,
      );
    }
    if (input.userId !== null) {
      const userCap = settings.userCaps[String(input.userId)];
      if (userCap !== undefined) {
        const userSpent = (
          sqlite.prepare(SPENT_SQL + " AND user_id = ?").get(start, input.userId) as { micros: number }
        ).micros;
        if (userSpent + est > Math.round(userCap * 1_000_000)) {
          throw new BudgetError(
            "Your DataForSEO budget reached: spent " + usd(userSpent) + " of $" + userCap.toFixed(2) + " this month (this call ~" + usd(est) + ").",
            "user",
            microsToUsd(userSpent),
            userCap,
          );
        }
      }
    }
    const r = sqlite
      .prepare(
        `INSERT INTO ext_dfs_ledger
           (user_id, client_id, endpoint, mode, units, estimated_cost_micros, status, cache_hit, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?)`,
      )
      .run(input.userId, input.clientId, input.endpoint, input.mode, input.units, est, input.requestId ?? null, now);
    return { id: Number(r.lastInsertRowid), estimatedMicros: est };
  });
  return tx.immediate();
}

export type LedgerRow = { id: number; userId: number | null; clientId: number | null; actualMicros: number };

/** Settle a reservation to the real cost. Returns null if it was not `reserved` (idempotent). */
export function settle(id: number, actualCostMicros: number, taskId?: string | null): LedgerRow | null {
  const r = sqlite
    .prepare(
      `UPDATE ext_dfs_ledger SET status='settled', actual_cost_micros=?, task_id=COALESCE(?, task_id), settled_at=?
       WHERE id=? AND status='reserved'`,
    )
    .run(Math.max(0, Math.round(actualCostMicros)), taskId ?? null, Date.now(), id);
  if (r.changes === 0) return null;
  return sqlite
    .prepare("SELECT id, user_id AS userId, client_id AS clientId, actual_cost_micros AS actualMicros FROM ext_dfs_ledger WHERE id=?")
    .get(id) as LedgerRow;
}

/** Give a reservation back (call failed / was not charged). */
export function release(id: number, status: "released" | "failed" = "released"): boolean {
  const r = sqlite
    .prepare(`UPDATE ext_dfs_ledger SET status=?, actual_cost_micros=0, settled_at=? WHERE id=? AND status='reserved'`)
    .run(status, Date.now(), id);
  return r.changes > 0;
}

/** Attach a DFS task id / request id to a reservation (for standard-queue polling). */
export function attachTask(id: number, taskId: string, requestId?: number | null): void {
  sqlite
    .prepare("UPDATE ext_dfs_ledger SET task_id=?, request_id=COALESCE(?, request_id) WHERE id=?")
    .run(taskId, requestId ?? null, id);
}

/** Record a cache hit: zero cost, `savedMicros` = what a miss would have cost. */
export function recordCacheHit(input: {
  userId: number | null;
  clientId: number | null;
  endpoint: EndpointId;
  mode: Mode;
  units?: number;
  savedMicros: number;
  requestId?: number | null;
}): void {
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO ext_dfs_ledger
        (user_id, client_id, endpoint, mode, units, estimated_cost_micros, actual_cost_micros, status, cache_hit, request_id, created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'settled', 1, ?, ?, ?)`,
    )
    .run(input.userId, input.clientId, input.endpoint, input.mode, input.units ?? 1, input.savedMicros, input.requestId ?? null, now, now);
}

export type MonthlySpend = {
  month: string;
  totalMicros: number;
  reservedMicros: number;
  byUser: { userId: number | null; micros: number }[];
  byClient: { clientId: number | null; micros: number }[];
  byEndpoint: { endpoint: string; micros: number; calls: number }[];
  cacheHits: number;
  savedMicros: number;
};

/** This UTC month's spend, optionally restricted to one user. For the Settings page. */
export function monthlySpend(opts: { userId?: number | null; now?: Date } = {}): MonthlySpend {
  const start = monthStartMs(opts.now);
  const hasUser = opts.userId !== undefined;
  const where =
    "created_at >= ? " + (hasUser ? (opts.userId === null ? "AND user_id IS NULL" : "AND user_id = ?") : "");
  const args: unknown[] = [start];
  if (hasUser && opts.userId !== null) args.push(opts.userId);
  const cost =
    "CASE WHEN status='settled' THEN COALESCE(actual_cost_micros,0) WHEN status='reserved' THEN estimated_cost_micros ELSE 0 END";
  const q = (sql: string) => sqlite.prepare(sql).all(...args) as Record<string, number | string | null>[];

  const byUser = q(`SELECT user_id AS userId, SUM(${cost}) AS micros FROM ext_dfs_ledger WHERE ${where} AND cache_hit=0 GROUP BY user_id ORDER BY micros DESC`);
  const byClient = q(`SELECT client_id AS clientId, SUM(${cost}) AS micros FROM ext_dfs_ledger WHERE ${where} AND cache_hit=0 GROUP BY client_id ORDER BY micros DESC`);
  const byEndpoint = q(`SELECT endpoint, SUM(${cost}) AS micros, COUNT(*) AS calls FROM ext_dfs_ledger WHERE ${where} AND cache_hit=0 AND status IN ('reserved','settled') GROUP BY endpoint ORDER BY micros DESC`);
  const hits = q(`SELECT COUNT(*) AS n, COALESCE(SUM(estimated_cost_micros),0) AS saved FROM ext_dfs_ledger WHERE ${where} AND cache_hit=1`)[0];
  const reserved = q(`SELECT COALESCE(SUM(estimated_cost_micros),0) AS m FROM ext_dfs_ledger WHERE ${where} AND status='reserved'`)[0];
  const total = byUser.reduce((a, r) => a + Number(r.micros ?? 0), 0);
  return {
    month: monthKey(opts.now),
    totalMicros: total,
    reservedMicros: Number(reserved.m),
    byUser: byUser.map((r) => ({ userId: r.userId as number | null, micros: Number(r.micros ?? 0) })),
    byClient: byClient.map((r) => ({ clientId: r.clientId as number | null, micros: Number(r.micros ?? 0) })),
    byEndpoint: byEndpoint.map((r) => ({ endpoint: String(r.endpoint), micros: Number(r.micros ?? 0), calls: Number(r.calls) })),
    cacheHits: Number(hits.n),
    savedMicros: Number(hits.saved),
  };
}

/** Month-to-date spend for the team (no arg) or one user, in micros (used by alerts). */
export function spentMicros(userId?: number | null, now?: Date): number {
  const start = monthStartMs(now);
  if (userId === undefined || userId === null) {
    return (sqlite.prepare(SPENT_SQL).get(start) as { micros: number }).micros;
  }
  return (sqlite.prepare(SPENT_SQL + " AND user_id = ?").get(start, userId) as { micros: number }).micros;
}
