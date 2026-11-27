import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sendMail = vi.fn();
vi.mock("@/lib/mailer", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("no scope"); }, cookies: async () => ({ get: () => undefined }) }));

import { db, sqlite } from "@/db/client";
import { clientMembers, clients, competitors, users } from "@/db/schema";
import { extDfsRequests } from "../db/schema";
import { runWithMcpContext, type McpCtx } from "../mcp/context";
import { currentAlerts } from "./alerts";
import { BudgetError } from "./budget";
import { getSettings, saveSettings } from "./config";
import { getVolumes, keywordIdeas, mergeTaskStates, pollPendingRequests, rankedKeywords } from "./service";
import { sweepStaleReservations } from "./sweep";
import { fixture, mockFetch, resetExtTables, useFakeCreds } from "./test-utils";

const legacy: McpCtx = { kind: "legacy", readOnly: false };
const asUser = (id: number): McpCtx => ({ kind: "user", userId: id, role: "member", readOnly: false });
const M = { location_code: 2840, language_code: "en" };

let A = 0;
let member = 0;

beforeEach(async () => {
  resetExtTables();
  sqlite.exec("DELETE FROM ext_dfs_requests");
  sendMail.mockReset().mockResolvedValue({ ok: true });
  useFakeCreds();
  await saveSettings({ teamCapUsd: 50 });
  const mk = (n: string, url: string) => db.insert(clients).values({ name: n + Math.random(), url }).returning().get().id;
  A = mk("a", "https://www.own-a.example");
  mk("b", "https://other-b.example");
  member = db.insert(users).values({ email: `m${Math.random()}@example.invalid`, passwordHash: "x", role: "member" }).returning().get().id;
  db.insert(clientMembers).values({ userId: member, clientId: A }).run();
});

const ledger = () => sqlite.prepare("SELECT * FROM ext_dfs_ledger WHERE cache_hit = 0").all() as { status: string; actual_cost_micros: number | null; estimated_cost_micros: number }[];
const request = (id: number) => db.select().from(extDfsRequests).where(eq(extDfsRequests.id, id)).get()!;

describe("ambiguous paid failures", () => {
  it("a live volume timeout/network error settles at the estimate and says it may have been charged", async () => {
    const { fn } = mockFetch({ "/search_volume/live": () => { throw new Error("socket hang up"); } });
    await expect(runWithMcpContext(legacy, () => getVolumes({ clientId: A, keywords: ["x"], mode: "live", ...M }))).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // not retried
    const rows = ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("settled");
    expect(rows[0].actual_cost_micros).toBe(rows[0].estimated_cost_micros);
    const req = db.select().from(extDfsRequests).all()[0];
    expect(req.status).toBe("failed");
    expect(req.error).toMatch(/may have been charged/);
  });

  it("a definite failure (envelope error) still releases at $0", async () => {
    mockFetch({ "/search_volume/live": () => ({ status_code: 40501, status_message: "bad field", tasks: [] }) });
    await expect(runWithMcpContext(legacy, () => getVolumes({ clientId: A, keywords: ["x"], mode: "live", ...M }))).rejects.toThrow();
    expect(ledger()[0]).toMatchObject({ status: "failed", actual_cost_micros: 0 });
  });
});

describe("in-flight volume dedup", () => {
  it("does not post keywords a pending request already covers", async () => {
    const { calls } = mockFetch({ "/task_post": () => fixture("volume_task_post.json") });
    const run = (kw: string[]) => runWithMcpContext(legacy, () => getVolumes({ clientId: A, keywords: kw, mode: "standard", ...M }));
    const first = await run(["alpha", "beta"]);
    expect(first.status).toBe("pending");
    expect(calls).toHaveLength(1);

    const again = await run(["beta", "alpha"]);
    expect(again).toMatchObject({ status: "pending", requestId: (first as { requestId: number }).requestId });
    expect(calls).toHaveLength(1); // nothing posted, nothing reserved
    expect(ledger()).toHaveLength(1);

    const partial = await run(["alpha", "gamma"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].body[0].keywords).toEqual(["gamma"]);
    expect(partial.status).toBe("pending");
    expect((partial as { pendingKeywords: string[] }).pendingKeywords.sort()).toEqual(["alpha", "gamma"]);
  });

  it("a different market is not deduped", async () => {
    const { calls } = mockFetch({ "/task_post": () => fixture("volume_task_post.json") });
    await runWithMcpContext(legacy, () => getVolumes({ clientId: A, keywords: ["alpha"], mode: "standard", ...M }));
    await runWithMcpContext(legacy, () => getVolumes({ clientId: A, keywords: ["alpha"], mode: "standard", location_code: 2826, language_code: "en" }));
    expect(calls).toHaveLength(2);
  });
});

describe("cache-only target restriction", () => {
  it("a member may read only their client's own domain or its competitors", async () => {
    useFakeCreds();
    db.insert(competitors).values({ clientId: A, name: "c", url: "https://www.rival.example/x" }).run();
    const ctx = asUser(member);
    const call = (target?: string) => runWithMcpContext(ctx, () => rankedKeywords({ clientId: A, target, cacheOnly: true, ...M }));
    await expect(call()).resolves.toMatchObject({ status: "cache_miss" });
    await expect(call("own-a.example")).resolves.toMatchObject({ status: "cache_miss" });
    await expect(call("rival.example")).resolves.toMatchObject({ status: "cache_miss" });
    await expect(call("other-b.example")).rejects.toThrow(/neither/);
  });

  it("owner-level callers keep reading any cached target; paid calls are unaffected", async () => {
    await expect(runWithMcpContext(legacy, () => rankedKeywords({ clientId: A, target: "other-b.example", cacheOnly: true, ...M }))).resolves.toMatchObject({ status: "cache_miss" });
    mockFetch({ "ranked_keywords": () => fixture("labs_ranked.json") });
    await expect(runWithMcpContext(asUser(member), () => rankedKeywords({ clientId: A, target: "other-b.example", cacheOnly: false, ...M }))).resolves.toMatchObject({ status: "ready" });
  });
});

describe("stale reservations", () => {
  it("settles old task-less reservations at the estimate and fails their request", () => {
    const old = Date.now() - 2 * 3_600_000;
    const reqId = db.insert(extDfsRequests).values({ clientId: A, userId: null, kind: "ideas", paramsJson: "{}", status: "pending", createdAt: new Date(old) }).returning().get().id;
    const ins = (created: number, task: string | null) =>
      sqlite.prepare("INSERT INTO ext_dfs_ledger (endpoint, mode, units, estimated_cost_micros, status, cache_hit, request_id, task_id, created_at) VALUES ('labs_keyword_ideas','live',1,5000,'reserved',0,?,?,?)").run(reqId, task, created);
    ins(old, null);
    ins(old, "task-1"); // has a task: the poller owns it
    ins(Date.now(), null); // fresh
    expect(sweepStaleReservations()).toBe(1);
    const rows = sqlite.prepare("SELECT status, actual_cost_micros AS a FROM ext_dfs_ledger ORDER BY id").all() as { status: string; a: number | null }[];
    expect(rows.map((r) => r.status)).toEqual(["settled", "reserved", "reserved"]);
    expect(rows[0].a).toBe(5000);
    expect(request(reqId).status).toBe("failed");
    expect(request(reqId).error).toMatch(/may have been charged/);
  });
});

describe("cap alert at the blocking threshold", () => {
  it("raises the 100% team alert once when reserve blocks, without a ledger write", async () => {
    await saveSettings({ teamCapUsd: 0.0001 });
    mockFetch({});
    for (let i = 0; i < 2; i++) {
      await expect(runWithMcpContext(legacy, () => getVolumes({ clientId: A, keywords: ["k" + i], mode: "live", ...M }))).rejects.toBeInstanceOf(BudgetError);
    }
    const alerts = currentAlerts().filter((a) => a.scope === "team");
    expect(alerts.map((a) => a.threshold)).toEqual([100]);
    expect(ledger()).toHaveLength(0);
  });
});

describe("poller", () => {
  const seed = (tasks: unknown[]) =>
    db.insert(extDfsRequests).values({
      clientId: A, userId: null, kind: "volume", status: "pending", createdAt: new Date(),
      paramsJson: JSON.stringify({ keywords: ["alpha"], locationCode: 2840, languageCode: "en" }),
      taskIdsJson: JSON.stringify(tasks),
    }).returning().get().id;
  const task = (extra = {}) => ({ taskId: "00000000-0000-0000-0000-000000000001", ledgerId: 1, keywords: ["alpha"], done: false, ...extra });

  it.each([[40100, "bad creds"], [40210, "no funds"]])("treats %i from free task_get as transient", async (code, msg) => {
    const id = seed([task()]);
    mockFetch({
      "tasks_ready": () => fixture("volume_tasks_ready.json"),
      "task_get": () => ({ status_code: 20000, status_message: "Ok.", tasks: [{ id: "t", status_code: code, status_message: msg, result: null }] }),
    });
    const r = await pollPendingRequests();
    expect(r.failed).toBe(0);
    expect(request(id).status).toBe("pending");
    expect(JSON.parse(request(id).taskIdsJson!)[0]).toMatchObject({ done: false });
  });

  it("a real task failure still marks the task failed", async () => {
    const id = seed([task()]);
    mockFetch({
      "tasks_ready": () => fixture("volume_tasks_ready.json"),
      "task_get": () => ({ status_code: 20000, status_message: "Ok.", tasks: [{ id: "t", status_code: 40501, status_message: "bad", result: null }] }),
    });
    await pollPendingRequests();
    expect(request(id).status).toBe("failed");
  });

  it("mergeTaskStates never un-dones a task finished by a concurrent poll", () => {
    const id = seed([task({ done: true, failed: false }), task({ taskId: "t2", keywords: ["b"] })]);
    const merged = mergeTaskStates(id, [task({ done: false }), task({ taskId: "t2", keywords: ["b"], done: true })]);
    expect(merged.map((t) => t.done)).toEqual([true, true]);
    expect(JSON.parse(request(id).taskIdsJson!).map((t: { done: boolean }) => t.done)).toEqual([true, true]);
  });
});

describe("ttl floor", () => {
  it("never lets a TTL be below one day, from storage or from saveSettings", async () => {
    await saveSettings({ ttlDays: { volume: 0, labs: 0.2, backlinks: 5 } });
    expect((await getSettings()).ttlDays).toEqual({ volume: 1, labs: 1, backlinks: 5 });
    sqlite.prepare("INSERT OR REPLACE INTO workspace_settings (key, value, updated_at) VALUES ('dataforseo.ttl_days', ?, ?)").run(JSON.stringify({ volume: 0 }), Date.now());
    expect((await getSettings()).ttlDays.volume).toBe(1);
  });
});

describe("cache key normalisation", () => {
  it("seed order does not change the key; suggestions key on the one seed it sends", async () => {
    const { calls } = mockFetch({ "keyword_ideas": () => fixture("labs_ideas.json"), "keyword_suggestions": () => fixture("labs_ideas.json") });
    const ideas = (seeds: string[], variant?: "ideas" | "suggestions", cacheOnly = false) =>
      runWithMcpContext(legacy, () => keywordIdeas({ clientId: A, seeds, variant, cacheOnly, ...M }));
    await ideas(["b", "a", "A"]);
    expect(await ideas(["a", "b"], "ideas", true)).toMatchObject({ status: "ready", cached: true });
    expect(calls).toHaveLength(1);

    await ideas(["zeta", "alpha"], "suggestions");
    expect(calls[1].body[0].keyword).toBe("alpha");
    expect(await ideas(["alpha"], "suggestions", true)).toMatchObject({ status: "ready", cached: true });
    expect(await ideas(["alpha", "omega"], "suggestions", true)).toMatchObject({ status: "ready", cached: true });
  });
});
