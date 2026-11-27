/**
 * Per-user MCP bearer tokens. Only the sha256 of a token is stored; the
 * plaintext is returned once, at creation.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { users, type Role } from "@/db/schema";
import { extMcpTokens } from "../db/schema";

export const TOKEN_PREFIX = "seo_mcp_";
const TOUCH_EVERY_MS = 5 * 60_000;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type TokenInfo = {
  id: number;
  label: string;
  readOnly: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type ResolvedToken = { tokenId: number; userId: number; role: Role; readOnly: boolean };

/** Creates a token. Viewers always get a read-only one. Plaintext is returned once. */
export function createToken(input: { userId: number; label: string; readOnly?: boolean }): { token: string; info: TokenInfo } {
  const user = db.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, input.userId)).get();
  if (!user || !user.active) throw new Error("User not found or inactive.");
  const label = input.label.trim().slice(0, 80) || "MCP token";
  const readOnly = user.role === "viewer" ? true : (input.readOnly ?? true);
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const row = db
    .insert(extMcpTokens)
    .values({ userId: input.userId, label, tokenHash: hashToken(token), readOnly, createdAt: new Date() })
    .returning()
    .get();
  return { token, info: toInfo(row) };
}

const toInfo = (r: typeof extMcpTokens.$inferSelect): TokenInfo => ({
  id: r.id, label: r.label, readOnly: r.readOnly, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt,
});

export function listTokens(userId: number): TokenInfo[] {
  return db.select().from(extMcpTokens).where(eq(extMcpTokens.userId, userId)).orderBy(desc(extMcpTokens.id)).all().map(toInfo);
}

/** Revokes one of the user's own tokens. False when it is not theirs or already revoked. */
export function revokeToken(userId: number, tokenId: number): boolean {
  const r = db
    .update(extMcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(extMcpTokens.id, tokenId), eq(extMcpTokens.userId, userId), isNull(extMcpTokens.revokedAt)))
    .run();
  return r.changes > 0;
}

const lastTouch = new Map<number, number>();

/** Maps a bearer token to an active user, or null. Never throws on bad input. */
export function resolveToken(bearer: string): ResolvedToken | null {
  if (!bearer.startsWith(TOKEN_PREFIX) || bearer.length > 200) return null;
  const row = db
    .select({
      id: extMcpTokens.id, userId: extMcpTokens.userId, readOnly: extMcpTokens.readOnly,
      lastUsedAt: extMcpTokens.lastUsedAt, role: users.role, active: users.active,
    })
    .from(extMcpTokens)
    .innerJoin(users, eq(users.id, extMcpTokens.userId))
    .where(and(eq(extMcpTokens.tokenHash, hashToken(bearer)), isNull(extMcpTokens.revokedAt)))
    .get();
  if (!row || !row.active) return null;
  touch(row.id, row.lastUsedAt);
  return { tokenId: row.id, userId: row.userId, role: row.role, readOnly: row.readOnly || row.role === "viewer" };
}

function touch(id: number, last: Date | null): void {
  const now = Date.now();
  if (now - (lastTouch.get(id) ?? 0) < TOUCH_EVERY_MS) return;
  if (last && now - last.getTime() < TOUCH_EVERY_MS) return;
  lastTouch.set(id, now);
  try {
    db.update(extMcpTokens).set({ lastUsedAt: new Date(now) }).where(eq(extMcpTokens.id, id)).run();
  } catch {
    // best-effort
  }
}

/** Tests only. */
export function resetTokenTouchCache(): void {
  lastTouch.clear();
}
