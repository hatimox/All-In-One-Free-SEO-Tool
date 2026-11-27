/**
 * Scheduler job: collect finished DataForSEO standard-queue tasks.
 *
 * Does a cheap SELECT first so an idle install never touches the network,
 * and refuses to overlap itself (a slow poll must not stack with the next
 * tick). task_get is free; see pollPendingRequests for idempotency.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { extDfsRequests } from "../db/schema";
import { pollPendingRequests } from "../dataforseo/service";
import { sweepStaleReservations } from "../dataforseo/sweep";

export const POLL_EVERY_MS = 2 * 60_000;

let running = false;

export function hasPendingRequests(): boolean {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(extDfsRequests)
    .where(and(eq(extDfsRequests.status, "pending"), eq(extDfsRequests.kind, "volume")))
    .get();
  return (row?.n ?? 0) > 0;
}

export async function tickDfsPoller(): Promise<{ skipped?: "overlap" | "idle"; checked?: number; completed?: number; failed?: number }> {
  if (running) return { skipped: "overlap" };
  running = true;
  try {
    try {
      sweepStaleReservations();
    } catch {
      /* best-effort housekeeping */
    }
    if (!hasPendingRequests()) return { skipped: "idle" };
    return await pollPendingRequests();
  } finally {
    running = false;
  }
}
