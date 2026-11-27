/**
 * Per-user token step of the /api/mcp authorisation, kept out of the route.
 * Returns null when the bearer is not a per-user token (caller then tries
 * the legacy workspace tokens).
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MCP_RATE_LIMIT, rateLimit } from "@/lib/mcp/rate-limit";
import type { McpCtx } from "./context";
import { TOKEN_PREFIX, resolveToken } from "./tokens";

export type UserAuth = { scope: "full" | "read_only"; ctx: McpCtx };

export function authorizeUserToken(req: Request): Response | UserAuth | null {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!bearer.startsWith(TOKEN_PREFIX)) return null;
  let t;
  try {
    t = resolveToken(bearer);
  } catch {
    return null;
  }
  if (!t) return null;

  const key = createHash("sha256").update(bearer).digest("hex").slice(0, 16);
  const verdict = rateLimit(key, MCP_RATE_LIMIT);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: `Too many requests on this token. Try again in ${verdict.retryAfterSeconds} second${verdict.retryAfterSeconds === 1 ? "" : "s"}.` },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }
  return {
    scope: t.readOnly ? "read_only" : "full",
    ctx: { kind: "user", userId: t.userId, role: t.role, readOnly: t.readOnly },
  };
}
