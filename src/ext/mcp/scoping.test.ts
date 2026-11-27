import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { clientMembers, clients, keywords, tasks, users } from "@/db/schema";
import { resetExtTables, useFakeCreds, mockFetch } from "../dataforseo/test-utils";
import { saveSettings } from "../dataforseo/config";
import { guardPaid, guardRead, PaidForbiddenError } from "../access/paid-guard";
import { runWithMcpContext, type McpCtx } from "./context";
import { dataforseoTools } from "./dataforseo-tools";
import { createToken, resolveToken } from "./tokens";
import { getKeywordRankings, getClientOverview, listClients, getTask, updateTask } from "@/lib/mcp/tools";
import { MCP_TOOL_LIST, READ_ONLY_TOOLS } from "@/lib/mcp/server";

let A = 0; // visible to the member
let B = 0; // not visible
let member = 0;
let viewer = 0;
let taskB = 0;

beforeEach(() => {
  resetExtTables();
  const mkClient = (name: string) => db.insert(clients).values({ name, url: `https://${name}.example.invalid` }).returning().get().id;
  A = mkClient("alpha" + Math.random().toString(36).slice(2, 6));
  B = mkClient("beta" + Math.random().toString(36).slice(2, 6));
  const mkUser = (role: "member" | "viewer") =>
    db.insert(users).values({ email: `${role}${Math.random()}@example.invalid`, passwordHash: "x", role }).returning().get().id;
  member = mkUser("member");
  viewer = mkUser("viewer");
  db.insert(clientMembers).values([{ userId: member, clientId: A }, { userId: viewer, clientId: A }]).run();
  db.insert(keywords).values([{ clientId: A, query: "kw-a" }, { clientId: B, query: "kw-b" }]).run();
  taskB = db.insert(tasks).values({ clientId: B, title: "secret task" } as never).returning().get().id;
});

const user = (id: number, role: "member" | "viewer", readOnly = false): McpCtx => ({ kind: "user", userId: id, role, readOnly });
const legacy: McpCtx = { kind: "legacy", readOnly: false };
const tool = (name: string) => dataforseoTools.find((t) => t.name === name)!;
const call = (ctx: McpCtx, name: string, args: Record<string, unknown>) =>
  runWithMcpContext(ctx, () => (tool(name).handler as (a: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>)(args));

describe("existing tools are scoped to the token's user", () => {
  it("list_clients shows only visible clients; legacy sees all", async () => {
    const mine = await runWithMcpContext(user(member, "member"), () => listClients());
    const ids = (mine as { data: { clients: { id: number }[] } }).data.clients.map((c) => c.id);
    expect(ids).toContain(A);
    expect(ids).not.toContain(B);
    const all = await runWithMcpContext(legacy, () => listClients());
    const allIds = (all as { data: { clients: { id: number }[] } }).data.clients.map((c) => c.id);
    expect(allIds).toEqual(expect.arrayContaining([A, B]));
  });

  it("keyword rankings and overview refuse another client as 'not found'", async () => {
    const ctx = user(member, "member");
    const own = await runWithMcpContext(ctx, () => getKeywordRankings({ clientId: A }));
    expect(own.ok).toBe(true);
    const other = await runWithMcpContext(ctx, () => getKeywordRankings({ clientId: B }));
    expect(other).toEqual({ ok: false, error: `No client with id ${B}.` });
    expect((await runWithMcpContext(ctx, () => getClientOverview(B))).ok).toBe(false);
    expect((await runWithMcpContext(legacy, () => getKeywordRankings({ clientId: B }))).ok).toBe(true);
  });

  it("record-id tools do not reach another client's task", async () => {
    const ctx = user(member, "member");
    expect((await runWithMcpContext(ctx, () => getTask(taskB))).ok).toBe(false);
    expect((await runWithMcpContext(ctx, () => updateTask({ taskId: taskB, status: "done" }))).ok).toBe(false);
    expect((await runWithMcpContext(legacy, () => getTask(taskB))).ok).toBe(true);
  });
});

describe("dataforseo tools", () => {
  it("cannot read another client's data, cached or paid", async () => {
    const { fn } = mockFetch({});
    for (const name of ["dfs_ranked_keywords", "dfs_ranked_keywords_fetch", "dfs_backlinks_overview"]) {
      const r = await call(user(member, "member"), name, { clientId: B, allowSpend: true });
      expect(r).toEqual({ ok: false, error: `No client with id ${B}.` });
    }
    const st = await call(user(member, "member"), "dfs_request_status", { clientId: B, requestId: 1 });
    expect(st.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("cache-only tools never call fetch and say cache_miss", async () => {
    useFakeCreds();
    const { fn } = mockFetch({});
    const r = await call(user(member, "member"), "dfs_ranked_keywords", { clientId: A });
    expect(r).toMatchObject({ ok: true, data: { source: "dataforseo", status: "cache_miss" } });
    const k = await call(legacy, "dfs_keyword_ideas", { clientId: A, seeds: ["x"] });
    expect(k).toMatchObject({ ok: true, data: { status: "cache_miss" } });
    expect(fn).not.toHaveBeenCalled();
  });

  it("paid tools need allowSpend: true", async () => {
    useFakeCreds();
    const { fn } = mockFetch({});
    const r = await call(legacy, "dfs_ranked_keywords_fetch", { clientId: A });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/allowSpend/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("read-only tokens cannot call a paid tool, and never see it listed", async () => {
    useFakeCreds();
    const { fn } = mockFetch({});
    const r = await call(user(member, "member", true), "dfs_ranked_keywords_fetch", { clientId: A, allowSpend: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/read-only/);
    expect(fn).not.toHaveBeenCalled();
    const names = new Set(READ_ONLY_TOOLS.map((t) => t.name));
    for (const t of MCP_TOOL_LIST.filter((x) => x.name.endsWith("_fetch"))) {
      expect(names.has(t.name), t.name).toBe(false);
      expect(t.annotations.readOnlyHint).toBe(false);
    }
    expect(names.has("dfs_ranked_keywords")).toBe(true);
  });

  it("surfaces a budget refusal as a tool error instead of silence", async () => {
    useFakeCreds(); // no team cap set -> every paid call is blocked
    const { fn } = mockFetch({});
    const r = await call(user(member, "member"), "dfs_ranked_keywords_fetch", { clientId: A, allowSpend: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Budget/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a viewer's paid call is forbidden with a clear error", async () => {
    useFakeCreds();
    await saveSettings({ teamCapUsd: 10 });
    const { fn } = mockFetch({});
    const r = await call(user(viewer, "viewer"), "dfs_ranked_keywords_fetch", { clientId: A, allowSpend: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not allowed|read-only/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("spend summary is team-wide for legacy, own for users", async () => {
    expect((await call(legacy, "dfs_spend_summary", {})).data).toMatchObject({ scope: "team" });
    expect((await call(user(member, "member"), "dfs_spend_summary", {})).data).toMatchObject({ scope: "own" });
  });
});

describe("paid-guard in MCP context", () => {
  it("legacy is owner-level; read-only legacy cannot spend", async () => {
    expect(await runWithMcpContext(legacy, () => guardPaid(B))).toBeNull();
    await expect(runWithMcpContext({ kind: "legacy", readOnly: true }, () => guardPaid(B))).rejects.toBeInstanceOf(PaidForbiddenError);
    expect(await runWithMcpContext({ kind: "legacy", readOnly: true }, () => guardRead(B))).toBeNull();
  });
  it("user context uses role and client visibility", async () => {
    expect(await runWithMcpContext(user(member, "member"), () => guardPaid(A))).toBe(member);
    await expect(runWithMcpContext(user(member, "member"), () => guardPaid(B))).rejects.toThrow(/Client not found/);
    await expect(runWithMcpContext(user(member, "member"), () => guardRead(B))).rejects.toThrow(/Client not found/);
    await expect(runWithMcpContext(user(viewer, "viewer"), () => guardPaid(A))).rejects.toThrow(/read-only/);
    expect(await runWithMcpContext(user(viewer, "viewer"), () => guardRead(A))).toBe(viewer);
  });
});

describe("token to context", () => {
  it("a viewer token resolves read-only", () => {
    const { token } = createToken({ userId: viewer, label: "v", readOnly: false });
    expect(resolveToken(token)!.readOnly).toBe(true);
  });
});

vi.mock("next/headers", () => ({ headers: async () => { throw new Error("no scope"); }, cookies: async () => ({ get: () => undefined }) }));
