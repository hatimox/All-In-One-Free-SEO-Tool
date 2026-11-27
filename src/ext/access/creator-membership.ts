/**
 * A member who creates a client could not then see it: visibility for
 * members comes from `client_members`, and nothing added them. Owners and
 * managers see every client already, so only the others need a row.
 * No-op on installs without accounts and in background jobs.
 */

import { db } from "@/db/client";
import { clientMembers } from "@/db/schema";

export async function grantCreatorMembership(clientId: number): Promise<void> {
  const { accountsEnabled, currentUser, seesAllClients } = await import(
    "@/lib/auth"
  );
  if (!accountsEnabled()) return;
  let me;
  try {
    me = await currentUser();
  } catch {
    return; // no request scope
  }
  if (!me || seesAllClients(me.role)) return;
  await db
    .insert(clientMembers)
    .values({ userId: me.id, clientId })
    .onConflictDoNothing();
}
