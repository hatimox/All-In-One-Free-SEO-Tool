/**
 * Signed OAuth `state` for the Google connect flow.
 *
 * The state used to be a bare "popup|clientId:12|ads" string that the
 * callback trusted: anyone who could reach the callback URL could choose
 * which client the resulting tokens were written to, and a signed-in user
 * could be tricked into completing someone else's flow. The state now
 * carries who started the flow, which client it targets and when it
 * expires, under an HMAC keyed with the session secret.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * `userId` is null on installs without accounts.
 */

import crypto from "node:crypto";
import { ensureSessionSecret } from "@/lib/session-secret";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStatePayload = {
  userId: number | null;
  clientId: number | null;
  popup: boolean;
  ads: boolean;
  /** epoch ms */
  exp: number;
};

export type VerifyResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

function mac(body: string, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(`google-oauth:${body}`).digest();
}

export function signOAuthState(
  input: Omit<OAuthStatePayload, "exp">,
  opts: { now?: number; secret?: string } = {},
): string {
  const payload: OAuthStatePayload = {
    ...input,
    exp: (opts.now ?? Date.now()) + OAUTH_STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = mac(body, opts.secret ?? ensureSessionSecret()).toString("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(
  state: string | null | undefined,
  opts: { now?: number; secret?: string } = {},
): VerifyResult {
  if (!state) return { ok: false, reason: "malformed" };
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [body, sig] = parts;
  const expected = mac(body, opts.secret ?? ensureSessionSecret());
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  let p: Partial<OAuthStatePayload>;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof p.exp !== "number" ||
    typeof p.popup !== "boolean" ||
    typeof p.ads !== "boolean" ||
    (p.userId !== null && typeof p.userId !== "number") ||
    (p.clientId !== null && typeof p.clientId !== "number")
  ) {
    return { ok: false, reason: "malformed" };
  }
  if ((opts.now ?? Date.now()) > p.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: p as OAuthStatePayload };
}

export type OAuthDecision = { ok: true } | { ok: false; error: string };

type Perms = Pick<
  typeof import("@/lib/auth"),
  "accountsEnabled" | "currentUser" | "canEdit" | "canManageSettings" | "canSeeClient"
>;

/**
 * Is the person completing the flow allowed to do what the state says?
 * Accounts mode only: the session user must be the one who started the flow,
 * must be able to edit, and must see the target client. A workspace-level
 * connection (no client, or the Ads token) is owner-only.
 * `perms` is injectable for tests; production uses `@/lib/auth`.
 */
export async function authoriseOAuthCallback(
  payload: OAuthStatePayload,
  perms?: Perms,
): Promise<OAuthDecision> {
  const p = perms ?? (await import("@/lib/auth"));
  if (!p.accountsEnabled()) return { ok: true };
  const me = await p.currentUser();
  if (!me) return { ok: false, error: "not-signed-in" };
  if (payload.userId !== me.id) return { ok: false, error: "state-user-mismatch" };
  if (!p.canEdit(me.role)) return { ok: false, error: "forbidden" };
  if (payload.clientId === null || payload.ads) {
    return p.canManageSettings(me.role)
      ? { ok: true }
      : { ok: false, error: "forbidden" };
  }
  if (!(await p.canSeeClient(me, payload.clientId))) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true };
}

/**
 * Build a signed state for the signed-in user (null userId when accounts are
 * off) and tell the caller whether they may start this flow at all.
 */
export async function startOAuthState(flags: {
  clientId: number | null;
  popup: boolean;
  ads: boolean;
}): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const { currentUserId } = await import("@/lib/auth");
  const payload = { userId: await currentUserId(), ...flags };
  const decision = await authoriseOAuthCallback({ ...payload, exp: 0 });
  if (!decision.ok) return decision;
  return { ok: true, state: signOAuthState(payload) };
}
