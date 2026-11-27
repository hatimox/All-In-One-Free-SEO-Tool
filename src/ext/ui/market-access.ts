/**
 * Who is looking at a market-data page, in the terms its panels need.
 * Server-only. Accounts off (single-user install) = everything allowed.
 */
import { accountsEnabled, canEdit, canManageSettings, currentUser } from "@/lib/auth";
import { getSettings, isConfigured } from "../dataforseo/config";
import type { Access } from "./market-data-shared";

export async function marketAccess(): Promise<{ access: Access; settings: Awaited<ReturnType<typeof getSettings>> }> {
  const [configured, settings] = await Promise.all([isConfigured(), getSettings()]);
  let canSpend = true;
  let isOwner = true;
  if (accountsEnabled()) {
    const me = await currentUser();
    canSpend = !!me && canEdit(me.role);
    isOwner = !!me && canManageSettings(me.role);
  }
  return { access: { canSpend, configured, isOwner }, settings };
}
