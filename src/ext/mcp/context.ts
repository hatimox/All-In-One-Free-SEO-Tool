/**
 * Who is on the other end of an MCP call, for the duration of that call.
 *
 * The route (or the stdio server) runs each request inside this
 * AsyncLocalStorage so the tool layer and paid-guard can answer "which
 * clients may this caller see, and may they write or spend?" without
 * threading a parameter through every tool.
 *
 *  - user:   a per-user token. Sees what that user sees (owner/manager: all;
 *            member/viewer: assigned clients). Viewer tokens are read-only.
 *  - legacy: the workspace-wide static tokens from Settings, and stdio.
 *            Owner-level, every client visible.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db/client";
import { clientMembers, type Role } from "@/db/schema";

export type McpCtx =
  | { kind: "user"; userId: number; role: Role; readOnly: boolean }
  | { kind: "legacy"; readOnly: boolean };

const store = new AsyncLocalStorage<McpCtx>();

export function runWithMcpContext<T>(ctx: McpCtx, fn: () => T): T {
  return store.run(ctx, fn);
}

/** The active context, or undefined when not inside an MCP call. */
export function getMcpContext(): McpCtx | undefined {
  return store.getStore();
}

/** The active context; outside any (stdio, tests) it is the owner-level legacy one. */
export function mcpContext(): McpCtx {
  return store.getStore() ?? { kind: "legacy", readOnly: false };
}

export class McpContextMissingError extends Error {
  constructor() {
    super("MCP request context is missing; refusing to run the tool without knowing who is calling.");
    this.name = "McpContextMissingError";
  }
}

/**
 * The context a tool call runs in. stdio (`requireContext` false) is the
 * owner-level legacy one when none is set; an HTTP-created server
 * (`requireContext` true) always has one from the route, and a missing store
 * is denied rather than silently promoted to owner-level.
 */
export function resolveToolContext(requireContext: boolean): McpCtx {
  const ctx = store.getStore();
  if (ctx) return ctx;
  if (requireContext) throw new McpContextMissingError();
  return { kind: "legacy", readOnly: false };
}

/** Client ids the caller may see; null = all. */
export function mcpVisibleClientIds(): number[] | null {
  const ctx = mcpContext();
  if (ctx.kind === "legacy") return null;
  if (ctx.role === "owner" || ctx.role === "manager") return null;
  return db
    .select({ clientId: clientMembers.clientId })
    .from(clientMembers)
    .where(eq(clientMembers.userId, ctx.userId))
    .all()
    .map((r) => r.clientId);
}

export function canSeeMcpClient(clientId: number): boolean {
  const ids = mcpVisibleClientIds();
  return ids === null || ids.includes(clientId);
}

export class McpScopeError extends Error {
  constructor(clientId: number) {
    // Same wording as a missing client: existence is not confirmed.
    super(`No client with id ${clientId}.`);
    this.name = "McpScopeError";
  }
}

export function assertMcpClient(clientId: number): void {
  if (!canSeeMcpClient(clientId)) throw new McpScopeError(clientId);
}

/** WHERE fragment restricting a client-id column to what the caller sees (undefined = no restriction). */
export function mcpClientFilter(col: SQLWrapper): SQL | undefined {
  const ids = mcpVisibleClientIds();
  if (ids === null) return undefined;
  return ids.length === 0 ? sql`0` : inArray(col as never, ids);
}

/** True when the caller sees every client (owner-level). */
export function mcpSeesAll(): boolean {
  return mcpVisibleClientIds() === null;
}

/** Is this applied/proposed agent action on a client the caller may see? */
export async function mcpActionVisible(actionId: number): Promise<boolean> {
  const { agentActions } = await import("@/db/schema");
  const row = db
    .select({ clientId: agentActions.clientId })
    .from(agentActions)
    .where(eq(agentActions.id, actionId))
    .get();
  return row ? canSeeMcpClient(row.clientId) : false;
}
