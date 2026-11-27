import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { resetExtTables } from "../dataforseo/test-utils";
import { TOKEN_PREFIX, createToken, listTokens, resetTokenTouchCache, resolveToken, revokeToken } from "./tokens";
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
  it("returns null for non-user bearers so legacy tokens are tried next", () => {
    expect(authorizeUserToken(req("legacytoken"))).toBeNull();
    expect(authorizeUserToken(req())).toBeNull();
    expect(authorizeUserToken(req(TOKEN_PREFIX + "bogus"))).toBeNull();
  });
  it("maps a token to a user context and scope", () => {
    resetRateLimits();
    const uid = mkUser("member");
    const ro = createToken({ userId: uid, label: "a" }).token;
    const rw = createToken({ userId: uid, label: "b", readOnly: false }).token;
    expect(authorizeUserToken(req(ro))).toMatchObject({ scope: "read_only", ctx: { kind: "user", userId: uid, readOnly: true } });
    expect(authorizeUserToken(req(rw))).toMatchObject({ scope: "full", ctx: { readOnly: false } });
  });
});
