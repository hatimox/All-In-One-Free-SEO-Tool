import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { resetExtTables } from "../dataforseo/test-utils";
import { TOKEN_PREFIX, createToken, listAllTokens, listTokens, resetTokenTouchCache, resolveToken, revokeAnyToken, revokeToken } from "./tokens";
import { perUserMcpEnabled, setPerUserMcpEnabled } from "./per-user-switch";
import { sqlite } from "@/db/client";

function mkUser(role: "owner" | "member" | "viewer", active = true) {
  return db
    .insert(users)
    .values({ email: `${role}${Math.random()}@example.invalid`, passwordHash: "x", role, active })
    .returning()
    .get().id;
}

beforeEach(() => {
  resetExtTables();
  resetTokenTouchCache();
});

describe("mcp tokens", () => {
  it("creates a prefixed token, stores only its hash, resolves it", () => {
    const uid = mkUser("member");
    const { token, info } = createToken({ userId: uid, label: " laptop ", readOnly: false });
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    const stored = sqlite.prepare("SELECT token_hash FROM ext_mcp_tokens").all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).not.toContain(token);
    expect(info.label).toBe("laptop");
    expect(resolveToken(token)).toMatchObject({ userId: uid, role: "member", readOnly: false });
    expect(resolveToken(token + "x")).toBeNull();
    expect(resolveToken("not-a-token")).toBeNull();
  });

  it("updates last_used_at on first use", () => {
    const uid = mkUser("member");
    const { token } = createToken({ userId: uid, label: "a" });
    expect(listTokens(uid)[0].lastUsedAt).toBeNull();
    resolveToken(token);
    expect(listTokens(uid)[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it("defaults to read-only and forces viewers read-only", () => {
    const m = mkUser("member");
    expect(createToken({ userId: m, label: "a" }).info.readOnly).toBe(true);
    const v = mkUser("viewer");
    const { token, info } = createToken({ userId: v, label: "a", readOnly: false });
    expect(info.readOnly).toBe(true);
    expect(resolveToken(token)!.readOnly).toBe(true);
  });

  it("revoke only works for the owner of the token and stops resolution", () => {
    const a = mkUser("member");
    const b = mkUser("member");
    const { token, info } = createToken({ userId: a, label: "a" });
    expect(revokeToken(b, info.id)).toBe(false);
    expect(resolveToken(token)).not.toBeNull();
    expect(revokeToken(a, info.id)).toBe(true);
    expect(resolveToken(token)).toBeNull();
    expect(revokeToken(a, info.id)).toBe(false);
  });

  it("fails once the user is deactivated and cannot be created for inactive users", () => {
    const uid = mkUser("member");
    const { token } = createToken({ userId: uid, label: "a" });
    db.update(users).set({ active: false }).where(eq(users.id, uid)).run();
    expect(resolveToken(token)).toBeNull();
    expect(() => createToken({ userId: uid, label: "b" })).toThrow();
  });
});

import { authorizeUserToken } from "./route-auth";
import { resetRateLimits } from "@/lib/mcp/rate-limit";

describe("route auth for per-user tokens", () => {
  const req = (tok?: string) => new Request("http://x/api/mcp", { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  it("returns null for non-user bearers so legacy tokens are tried next", async () => {
    expect(await authorizeUserToken(req("legacytoken"))).toBeNull();
    expect(await authorizeUserToken(req())).toBeNull();
    expect(await authorizeUserToken(req(TOKEN_PREFIX + "bogus"))).toBeNull();
  });
  it("maps a token to a user context and scope", async () => {
    resetRateLimits();
    const uid = mkUser("member");
    const ro = createToken({ userId: uid, label: "a" }).token;
    const rw = createToken({ userId: uid, label: "b", readOnly: false }).token;
    expect(await authorizeUserToken(req(ro))).toMatchObject({ scope: "read_only", ctx: { kind: "user", userId: uid, readOnly: true } });
    expect(await authorizeUserToken(req(rw))).toMatchObject({ scope: "full", ctx: { readOnly: false } });
  });
  it("refuses every per-user token with a 503 once the owner turns the switch off", async () => {
    resetRateLimits();
    const uid = mkUser("member");
    const tok = createToken({ userId: uid, label: "a" }).token;
    expect(await perUserMcpEnabled()).toBe(true); // default on
    await setPerUserMcpEnabled(false);
    try {
      const res = (await authorizeUserToken(req(tok))) as Response;
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/Remote MCP is off/);
      // non-user bearers are unaffected (legacy tokens have their own switch)
      expect(await authorizeUserToken(req("legacytoken"))).toBeNull();
    } finally {
      await setPerUserMcpEnabled(true);
    }
    expect(await authorizeUserToken(req(tok))).toMatchObject({ scope: "read_only" });
  });
});

describe("owner token administration", () => {
  it("lists every user's tokens and revokes any of them", () => {
    const a = mkUser("member");
    const b = mkUser("viewer");
    const ta = createToken({ userId: a, label: "a-tok" });
    createToken({ userId: b, label: "b-tok" });
    const all = listAllTokens().filter((t) => [a, b].includes(t.userId));
    expect(all.map((t) => t.label).sort()).toEqual(["a-tok", "b-tok"]);
    expect(all[0]).toHaveProperty("userEmail");
    expect(revokeAnyToken(ta.info.id)).toBe(true);
    expect(resolveToken(ta.token)).toBeNull();
    expect(revokeAnyToken(ta.info.id)).toBe(false);
  });
});
