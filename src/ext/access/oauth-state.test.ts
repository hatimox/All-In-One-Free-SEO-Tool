import { describe, expect, it } from "vitest";
import {
  OAUTH_STATE_TTL_MS,
  authoriseOAuthCallback,
  signOAuthState,
  verifyOAuthState,
} from "./oauth-state";

const secret = "test-secret-test-secret-test-secret";
const base = { userId: 7, clientId: 12, popup: true, ads: false };

describe("oauth state", () => {
  it("round-trips the payload and keeps flags", () => {
    const s = signOAuthState(base, { secret, now: 1000 });
    const r = verifyOAuthState(s, { secret, now: 2000 });
    expect(r).toEqual({ ok: true, payload: { ...base, exp: 1000 + OAUTH_STATE_TTL_MS } });
  });

  it("rejects tampering with payload or signature", () => {
    const s = signOAuthState(base, { secret });
    const [body, sig] = s.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...base, clientId: 99, exp: Date.now() + 1e6 }),
    ).toString("base64url");
    expect(verifyOAuthState(`${forged}.${sig}`, { secret })).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    expect(verifyOAuthState(`${body}.${sig.slice(0, -2)}AA`, { secret }).ok).toBe(false);
  });

  it("rejects a different secret, legacy plain state and garbage", () => {
    const s = signOAuthState(base, { secret });
    expect(verifyOAuthState(s, { secret: "other-secret-other-secret-other!!" }).ok).toBe(false);
    expect(verifyOAuthState("popup|clientId:3", { secret })).toMatchObject({ ok: false });
    expect(verifyOAuthState("", { secret })).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyOAuthState(null, { secret }).ok).toBe(false);
  });

  it("expires after ten minutes", () => {
    const s = signOAuthState(base, { secret, now: 0 });
    expect(verifyOAuthState(s, { secret, now: OAUTH_STATE_TTL_MS }).ok).toBe(true);
    expect(verifyOAuthState(s, { secret, now: OAUTH_STATE_TTL_MS + 1 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("authoriseOAuthCallback", () => {
  const visible = new Set([12]);
  const mk = (accounts: boolean, user: { id: number; role: string } | null) =>
    ({
      accountsEnabled: () => accounts,
      currentUser: async () => user,
      canEdit: (r: string) => r !== "viewer",
      canManageSettings: (r: string) => r === "owner",
      canSeeClient: async (u: { role: string }, id: number) =>
        u.role === "owner" || u.role === "manager" || visible.has(id),
    }) as never;
  const payload = { ...base, exp: Date.now() + 1000 };

  it("allows everything on installs without accounts", async () => {
    expect(await authoriseOAuthCallback(payload, mk(false, null))).toEqual({ ok: true });
  });

  it("requires a session and the same user who started the flow", async () => {
    expect(await authoriseOAuthCallback(payload, mk(true, null))).toMatchObject({ ok: false });
    expect(
      await authoriseOAuthCallback(payload, mk(true, { id: 8, role: "member" })),
    ).toEqual({ ok: false, error: "state-user-mismatch" });
    expect(
      await authoriseOAuthCallback(payload, mk(true, { id: 7, role: "member" })),
    ).toEqual({ ok: true });
  });

  it("blocks viewers and clients the member cannot see", async () => {
    expect(
      await authoriseOAuthCallback(payload, mk(true, { id: 7, role: "viewer" })),
    ).toMatchObject({ ok: false });
    expect(
      await authoriseOAuthCallback(
        { ...payload, clientId: 13 },
        mk(true, { id: 7, role: "member" }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("makes workspace-level and Ads connections owner-only", async () => {
    const ws = { ...payload, clientId: null };
    expect(await authoriseOAuthCallback(ws, mk(true, { id: 7, role: "manager" }))).toMatchObject({ ok: false });
    expect(await authoriseOAuthCallback(ws, mk(true, { id: 7, role: "owner" }))).toEqual({ ok: true });
    const ads = { ...payload, ads: true };
    expect(await authoriseOAuthCallback(ads, mk(true, { id: 7, role: "member" }))).toMatchObject({ ok: false });
    expect(await authoriseOAuthCallback(ads, mk(true, { id: 7, role: "owner" }))).toEqual({ ok: true });
  });
});
