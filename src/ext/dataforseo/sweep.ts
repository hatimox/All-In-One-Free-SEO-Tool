/**
 * Leaked reservations: a paid call interrupted by a crash leaves a `reserved`
 * ledger row (no task id) forever, counting against the budget. After an hour
 * such rows are settled at their ESTIMATE, not released at $0: the call may
 * already have been billed (see client.ts, paid POSTs are never retried on
 * timeout). Their request is marked failed when it never recorded any task.
 */
import { sqlite } from "@/db/client";

export const STALE_RESERVATION_MS = 3_600_000;

export function sweepStaleReservations(now = Date.now()): number {
  const tx = sqlite.transaction((): number => {
    const rows = sqlite
      .prepare(
        `SELECT id, request_id AS requestId FROM ext_dfs_ledger
         WHERE status = 'reserved' AND task_id IS NULL AND cache_hit = 0 AND created_at < ?`,
      )
      .all(now - STALE_RESERVATION_MS) as { id: number; requestId: number | null }[];
    for (const r of rows) {
      sqlite
        .prepare(
          `UPDATE ext_dfs_ledger SET status='settled', actual_cost_micros=estimated_cost_micros, settled_at=?
           WHERE id=? AND status='reserved'`,
        )
        .run(now, r.id);
      if (r.requestId !== null) {
        sqlite
          .prepare(
            `UPDATE ext_dfs_requests SET status='failed', completed_at=?,
               error='Interrupted before DataForSEO answered. The call may have been charged; the estimated cost was kept on the ledger.'
             WHERE id=? AND status='pending' AND task_ids_json IS NULL`,
          )
          .run(now, r.requestId);
      }
    }
    return rows.length;
  });
  return tx.immediate();
}
