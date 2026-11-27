/**
 * Record-level access control.
 *
 * `guardAction("edit")` only checks the caller's role. Several actions take
 * a record id (a keyword, a backlink, an audit) rather than a client id, so
 * a member could pass the id of a record that belongs to a client they were
 * never assigned. These helpers derive the owning client FROM THE RECORD and
 * enforce visibility on that, so the check cannot be skipped by lying about
 * which client the record belongs to.
 *
 * Three entry points, one lookup:
 *   assertRecordClientAccess  server actions (role + client, via guardAction)
 *   assertRecordPageAccess    pages / layouts (notFound() when not visible)
 *   canAccessRecord           route handlers (boolean, answer your own 404)
 *
 * Existence is never leaked: a record that does not exist and a record of a
 * client the caller may not see are indistinguishable to a member.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  audits,
  backlinks,
  invoices,
  keywordRankings,
  keywords,
  reportArchives,
  serpScans,
  serpScreenshots,
  tasks,
} from "@/db/schema";
import { guardAction, type ActionNeed } from "@/lib/action-guard";
import { assertClientAccess, canAccessClient } from "@/lib/client-scope";

export type RecordKind =
  | "keyword"
  | "backlink"
  | "ranking"
  | "serpScan"
  | "screenshot"
  | "audit"
  | "report"
  | "invoice"
  | "task";

/**
 * A client id no real client has. Passed to guardAction for a record that
 * does not exist, so a member gets "Client not found." exactly as they would
 * for a record of someone else's client, while an owner/manager (who can see
 * every client) simply proceeds to a harmless no-op.
 */
const MISSING_CLIENT = Number.MAX_SAFE_INTEGER;

/** The client that owns a record, or null when the record does not exist. */
export function recordClientId(kind: RecordKind, id: number): number | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  // Tables that hold a clientId directly.
  const direct = {
    keyword: [keywords, keywords.id, keywords.clientId],
    backlink: [backlinks, backlinks.id, backlinks.clientId],
    audit: [audits, audits.id, audits.clientId],
    report: [reportArchives, reportArchives.id, reportArchives.clientId],
    invoice: [invoices, invoices.id, invoices.clientId],
    task: [tasks, tasks.id, tasks.clientId],
  } as const;
  if (kind in direct) {
    const [table, idCol, clientCol] = direct[kind as keyof typeof direct];
    const row = db
      .select({ clientId: clientCol })
      .from(table as typeof keywords)
      .where(eq(idCol as typeof keywords.id, id))
      .get();
    return (row?.clientId as number | undefined) ?? null;
  }
  // Child rows of a keyword: the client is the keyword's.
  const child = {
    ranking: [keywordRankings, keywordRankings.id, keywordRankings.keywordId],
    serpScan: [serpScans, serpScans.id, serpScans.keywordId],
    screenshot: [serpScreenshots, serpScreenshots.id, serpScreenshots.keywordId],
  } as const;
  const [table, idCol, kwCol] = child[kind as keyof typeof child];
  const row = db
    .select({ clientId: keywords.clientId })
    .from(table as typeof keywordRankings)
    .innerJoin(keywords, eq(keywords.id, kwCol as typeof keywordRankings.keywordId))
    .where(eq(idCol as typeof keywordRankings.id, id))
    .get();
  return row?.clientId ?? null;
}

/**
 * Server actions. Enforces role (`need`) AND that the record's client is
 * visible to the caller. No-ops exactly where `guardAction` does (background
 * jobs, non-action requests, installs without accounts). Returns the owning
 * client id, or null if the record does not exist.
 */
export async function assertRecordClientAccess(
  kind: RecordKind,
  id: number,
  need: ActionNeed = "edit",
): Promise<number | null> {
  const clientId = recordClientId(kind, id);
  await guardAction(need, clientId ?? MISSING_CLIENT);
  return clientId;
}

/** Pages and layouts: 404 when the record's client is not visible. */
export async function assertRecordPageAccess(
  kind: RecordKind,
  id: number,
): Promise<number | null> {
  const clientId = recordClientId(kind, id);
  await assertClientAccess(clientId ?? MISSING_CLIENT);
  return clientId;
}

/** Route handlers: true when the record exists and its client is visible. */
export async function canAccessRecord(
  kind: RecordKind,
  id: number,
): Promise<boolean> {
  const clientId = recordClientId(kind, id);
  if (clientId === null) return false;
  return canAccessClient(clientId);
}

/**
 * The client ids the caller may act on, or null for "all". Background jobs
 * (no request scope, so no session) get null, matching guardAction. Used by
 * batch actions that would otherwise sweep every client.
 */
export async function visibleClientIdsForAction(): Promise<number[] | null> {
  try {
    const { scopedClientIds } = await import("@/lib/client-scope");
    return await scopedClientIds();
  } catch {
    return null; // no request scope — scheduler
  }
}
