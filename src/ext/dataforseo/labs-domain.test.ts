import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mailer", () => ({ sendMail: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/headers", () => ({ headers: async () => { throw new Error("no scope"); }, cookies: async () => ({ get: () => undefined }) }));

import { db, sqlite } from "@/db/client";
import { clientMembers, clients, users } from "@/db/schema";
import { runWithMcpContext, type McpCtx } from "../mcp/context";
import { saveSettings } from "./config";
import { domainCompetitors, domainOverview, keywordDifficulty, rankedKeywords, searchIntent, topPages } from "./service";
import { recentSearches } from "./history";
import { fixture, mockFetch, resetExtTables, useFakeCreds } from "./test-utils";

const legacy: McpCtx = { kind: "legacy", readOnly: false };
const asUser = (id: number): McpCtx => ({ kind: "user", userId: id, role: "member", readOnly: false });
const M = { location_code: 2840, language_code: "en" };

let A = 0;
let B = 0;
let member = 0;

beforeEach(async () => {
  resetExtTables();
  useFakeCreds();
  await saveSettings({ teamCapUsd: 50 });
  const mk = (n: string, url: string) => db.insert(clients).values({ name: n + Math.random(), url }).returning().get().id;
  A = mk("a", "https://www.own-a.example");
  B = mk("b", "https://other-b.example");
  member = db.insert(users).values({ email: `m${Math.random()}@example.invalid`, passwordHash: "x", role: "member" }).returning().get().id;
  db.insert(clientMembers).values({ userId: member, clientId: A }).run();
});

const routes = () => ({
  "/bulk_keyword_difficulty/live": () => fixture("labs_bulk_difficulty.json"),
  "/search_intent/live": () => fixture("labs_search_intent.json"),
  "/domain_rank_overview/live": () => fixture("labs_domain_overview.json"),
  "/relevant_pages/live": () => fixture("labs_relevant_pages.json"),
  "/competitors_domain/live": () => fixture("labs_competitors_domain.json"),
  "/ranked_keywords/live": () => fixture("labs_ranked.json"),
});

describe("domain-level Labs service calls", () => {
  it("fetch once, then serve from cache for free", async () => {
    const { calls } = mockFetch(routes());
    const run = () => runWithMcpContext(legacy, async () => ({
      d: await keywordDifficulty({ clientId: A, keywords: ["Seo Tool", "seo tool", "free rank tracker"], ...M }),
      i: await searchIntent({ clientId: A, keywords: ["buy seo tool"], ...M }),
      o: await domainOverview({ clientId: A, target: "example.com", ...M }),
      p: await topPages({ clientId: A, target: "example.com", ...M }),
      c: await domainCompetitors({ clientId: A, target: "example.com", ...M }),
    }));
    const first = await run();
    expect(calls).toHaveLength(5);
    expect(calls[0].body[0].keywords).toEqual(["free rank tracker", "seo tool"]);
    expect(calls[1].body[0]).toMatchObject({ language_code: "en" });
    expect(first.d).toMatchObject({ status: "ready", cached: false });
    expect(first.o.status === "ready" && first.o.data.organicKeywords).toBe(290);
    const second = await run();
    expect(calls).toHaveLength(5);
    expect(second.c).toMatchObject({ status: "ready", cached: true, costUsd: 0 });
  });

  it("cacheOnly never calls the network", async () => {
    const { calls } = mockFetch(routes());
    const r = await runWithMcpContext(legacy, () => keywordDifficulty({ clientId: A, keywords: ["x"], cacheOnly: true, ...M }));
    expect(r).toEqual({ status: "cache_miss" });
    expect(calls).toHaveLength(0);
  });

  it("a failed difficulty call that may have been charged is settled at the estimate", async () => {
    mockFetch({ "/bulk_keyword_difficulty/live": () => { throw new Error("socket hang up"); } });
    await expect(runWithMcpContext(legacy, () => keywordDifficulty({ clientId: A, keywords: ["x"], ...M }))).rejects.toThrow();
    const rows = sqlite.prepare("SELECT status FROM ext_dfs_ledger WHERE cache_hit = 0").all() as { status: string }[];
    expect(rows.map((r) => r.status)).toEqual(["settled"]);
  });
});

describe("cache-only target rule", () => {
  it("allows a target this client already requested, refuses one it never did", async () => {
    mockFetch(routes());
    await runWithMcpContext(legacy, () => domainOverview({ clientId: A, target: "looked-up.example", ...M }));
    const ro = (target: string) => runWithMcpContext(asUser(member), () => topPages({ clientId: A, target, cacheOnly: true, ...M }));
    await expect(ro("looked-up.example")).resolves.toMatchObject({ status: "cache_miss" });
    await expect(ro("never-requested.example")).rejects.toThrow(/neither/);
  });

  it("does not let client A read a domain only client B requested", async () => {
    mockFetch(routes());
    await runWithMcpContext(legacy, () => rankedKeywords({ clientId: B, target: "b-only.example", ...M }));
    await expect(
      runWithMcpContext(asUser(member), () => domainOverview({ clientId: A, target: "b-only.example", cacheOnly: true, ...M })),
    ).rejects.toThrow(/neither/);
  });
});

describe("recentSearches", () => {
  it("returns only this client's rows, newest first, de-duplicated", async () => {
    mockFetch(routes());
    await runWithMcpContext(legacy, async () => {
      await keywordDifficulty({ clientId: A, keywords: ["alpha"], ...M });
      await domainOverview({ clientId: A, target: "example.com", ...M });
      await domainOverview({ clientId: A, target: "example.com", ...M }); // cache hit, duplicate
      await domainOverview({ clientId: B, target: "b-secret.example", ...M });
    });
    const rows = await runWithMcpContext(asUser(member), () => recentSearches({ clientId: A }));
    expect(rows.map((r) => [r.kind, r.query ?? r.target])).toEqual([["domain_overview", "example.com"], ["keyword_difficulty", "alpha"]]);
    expect(JSON.stringify(rows)).not.toContain("b-secret");
    expect(rows[0]).toMatchObject({ status: "ready", market: { locationCode: 2840, languageCode: "en" } });
    await expect(runWithMcpContext(asUser(member), () => recentSearches({ clientId: B }))).rejects.toThrow();
  });
});
