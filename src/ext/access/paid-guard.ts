/**
 * Who may trigger a PAID DataForSEO call.
 *
 * - Request scope (a page / server action / route is running):
 *     accounts disabled (single-user local install) -> allowed, userId null
 *     signed out -> forbidden
 *     viewer -> forbidden (viewers are read-only; use cacheOnly)
 *     member -> must be able to see the client
 *     owner / manager -> allowed
 * - No request scope (scheduler / background job): allowed only when the
 *   `dataforseo.automations_may_spend` setting is on; userId null.
 *
 * Mirrors src/lib/action-guard.ts: `headers()` throws outside a request.
 */
import { headers } from "next/headers";
import { getSettings } from "../dataforseo/config";

export class PaidForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidForbiddenError";
  }
}

async function inRequestScope(): Promise<boolean> {
  try {
    await headers();
    return true;
  } catch {
    return false;
  }
}

/** Returns the user id to attribute spend to (null = local mode or scheduler). Throws PaidForbiddenError. */
export async function guardPaid(clientId: number | null): Promise<number | null> {
  if (!(await inRequestScope())) {
    if (!(await getSettings()).automationsMaySpend) {
      throw new PaidForbiddenError(
        "Automations are not allowed to spend DataForSEO budget (enable it in DataForSEO settings).",
      );
    }
    return null;
  }
  const { accountsEnabled, currentUser, canEdit, canSeeClient } = await import("@/lib/auth");
  if (!accountsEnabled()) return null;
  const me = await currentUser();
  if (!me) throw new PaidForbiddenError("Sign in first.");
  if (!canEdit(me.role)) throw new PaidForbiddenError("Your role is read-only and cannot spend DataForSEO budget.");
  if (clientId !== null && !(await canSeeClient(me, clientId))) {
    throw new PaidForbiddenError("Client not found.");
  }
  return me.id;
}

/** Non-spending variant for cacheOnly reads: may this caller see the client? Returns user id or null. */
export async function guardRead(clientId: number | null): Promise<number | null> {
  if (!(await inRequestScope())) return null;
  const { accountsEnabled, currentUser, canSeeClient } = await import("@/lib/auth");
  if (!accountsEnabled()) return null;
  const me = await currentUser();
  if (!me) throw new PaidForbiddenError("Sign in first.");
  if (clientId !== null && !(await canSeeClient(me, clientId))) throw new PaidForbiddenError("Client not found.");
  return me.id;
}
