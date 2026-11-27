/**
 * Owner-only gate for route handlers that spend the workspace's provider
 * quota or touch its keys. Accounts mode only — open and shared-password
 * installs keep their existing behaviour. Returns a Response to send, or
 * null to proceed.
 */
export async function guardOwnerWhenAccounts(): Promise<Response | null> {
  const { accountsEnabled, currentUser, canManageSettings } = await import(
    "@/lib/auth"
  );
  if (!accountsEnabled()) return null;
  const me = await currentUser();
  if (!me) {
    return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }
  if (!canManageSettings(me.role)) {
    return Response.json(
      { ok: false, error: "Only the workspace owner can do this." },
      { status: 403 },
    );
  }
  return null;
}
