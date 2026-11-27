import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ role: "owner" as "owner" | "viewer" }));
const guardCalls: [string, unknown][] = [];

vi.mock("@/lib/action-guard", async () => {
  class ActionForbiddenError extends Error {}
  return {
    ActionForbiddenError,
    guardAction: async (need: string, clientId?: unknown) => {
      guardCalls.push([need, clientId]);
      if ((need === "edit" || need === "settings") && st.role === "viewer") {
        throw new ActionForbiddenError("You have read-only access.");
      }
    },
  };
});
vi.mock("@/lib/client-scope", () => ({ clientScope: async () => undefined }));
vi.mock("@/ext/ui/market-access", () => ({ marketAccess: async () => ({ access: {}, settings: { defaultMode: "standard" } }) }));

const metrics = vi.hoisted(() => ({ getKeywordMetrics: vi.fn() }));
vi.mock("@/ext/providers/keyword-metrics", () => metrics);
const svc = vi.hoisted(() => ({
  keywordIdeas: vi.fn(),
  rankedKeywords: vi.fn(),
  backlinksSummary: vi.fn(),
  referringDomains: vi.fn(),
  backlinkGap: vi.fn(),
  pollPendingRequests: vi.fn(),
  getRequest: vi.fn(),
}));
vi.mock("@/ext/dataforseo/service", () => svc);
vi.mock("./research", () => ({ loadKeywordView: vi.fn(), loadDomainView: vi.fn(), loadIdeas: vi.fn() }));
vi.mock("@/lib/serp-scanner", () => ({ scanSerp: vi.fn() }));
vi.mock("@/app/tools/keyword-difficulty/actions", () => ({ estimateDifficulty: vi.fn() }));
vi.mock("@/app/keywords/actions", () => ({ trackKeyword: vi.fn() }));

import { BudgetError } from "@/ext/dataforseo/budget";
import { PaidForbiddenError } from "@/ext/access/paid-guard";
import { DataForSeoError } from "@/ext/dataforseo/client";
import {
  lookupBacklinkGap,
  lookupBacklinks,
  lookupIdeas,
  lookupKeywords,
  lookupRankedKeywords,
  pollRequest,
} from "./actions";

beforeEach(() => {
  st.role = "owner";
  guardCalls.length = 0;
  vi.clearAllMocks();
});

describe("market-data actions: guards", () => {
  it("pass the client id to guardAction; cached lookups need only read, paid ones need edit", async () => {
    metrics.getKeywordMetrics.mockResolvedValue({ status: "ready", items: [] });
    await lookupKeywords({ clientId: 7, keywords: "a", spend: false });
    await lookupKeywords({ clientId: 7, keywords: "a", spend: true });
    expect(guardCalls).toEqual([
      ["read", 7],
      ["edit", 7],
    ]);
  });

  it("every action calls guardAction with the client id", async () => {
    svc.keywordIdeas.mockResolvedValue({ status: "cache_miss" });
    svc.rankedKeywords.mockResolvedValue({ status: "cache_miss" });
    svc.backlinksSummary.mockResolvedValue({ status: "cache_miss" });
    svc.backlinkGap.mockResolvedValue({ status: "cache_miss" });
    svc.getRequest.mockResolvedValue(null);
    await lookupIdeas({ clientId: 3, seeds: "x", variant: "ideas", spend: false });
    await lookupRankedKeywords({ clientId: 3, target: "", spend: false });
    await lookupBacklinks({ clientId: 3, spend: false });
    await lookupBacklinkGap({ clientId: 3, competitors: ["a.com"], spend: false });
    await pollRequest({ clientId: 3, requestId: 1 });
    expect(guardCalls).toHaveLength(5);
    expect(guardCalls.every(([, id]) => id === 3)).toBe(true);
  });

  it("a viewer cannot trigger a paid fetch: the guard throws before any service call", async () => {
    st.role = "viewer";
    await expect(lookupKeywords({ clientId: 1, keywords: "a", spend: true })).rejects.toThrow(/read-only/);
    await expect(lookupIdeas({ clientId: 1, seeds: "a", variant: "ideas", spend: true })).rejects.toThrow();
    await expect(lookupRankedKeywords({ clientId: 1, target: "a.com", spend: true })).rejects.toThrow();
    await expect(lookupBacklinks({ clientId: 1, spend: true })).rejects.toThrow();
    await expect(lookupBacklinkGap({ clientId: 1, competitors: ["a.com"], spend: true })).rejects.toThrow();
    expect(metrics.getKeywordMetrics).not.toHaveBeenCalled();
    expect(svc.keywordIdeas).not.toHaveBeenCalled();
    expect(svc.rankedKeywords).not.toHaveBeenCalled();
    expect(svc.backlinksSummary).not.toHaveBeenCalled();
    expect(svc.backlinkGap).not.toHaveBeenCalled();
  });

  it("a viewer can still read the cache (spend false) and the service is told cacheOnly", async () => {
    st.role = "viewer";
    svc.keywordIdeas.mockResolvedValue({ status: "cache_miss" });
    const r = await lookupIdeas({ clientId: 1, seeds: "a", variant: "ideas", spend: false });
    expect(r).toEqual({ ok: true, status: "cache_miss" });
    expect(svc.keywordIdeas).toHaveBeenCalledWith(expect.objectContaining({ cacheOnly: true }));
  });

  it("spend:false never lets the metrics provider spend", async () => {
    metrics.getKeywordMetrics.mockResolvedValue({ status: "ready", items: [] });
    await lookupKeywords({ clientId: 1, keywords: "a", spend: false });
    expect(metrics.getKeywordMetrics).toHaveBeenCalledWith(expect.objectContaining({ allowSpend: false }));
  });
});

describe("market-data actions: error mapping", () => {
  it("maps BudgetError, PaidForbiddenError, not-configured and switched-off", async () => {
    svc.keywordIdeas.mockRejectedValueOnce(new BudgetError("Team DataForSEO budget reached", "team", 5, 5));
    expect(await lookupIdeas({ clientId: 1, seeds: "a", variant: "ideas", spend: true })).toMatchObject({
      ok: false,
      kind: "budget",
    });
    svc.rankedKeywords.mockRejectedValueOnce(new PaidForbiddenError("Client not found."));
    expect(await lookupRankedKeywords({ clientId: 1, target: "a.com", spend: true })).toMatchObject({
      ok: false,
      kind: "forbidden",
    });
    svc.backlinkGap.mockRejectedValueOnce(new DataForSeoError("DataForSEO is not configured.", null, false));
    expect(await lookupBacklinkGap({ clientId: 1, competitors: ["a.com"], spend: true })).toMatchObject({
      ok: false,
      kind: "not_configured",
    });
    svc.backlinksSummary.mockRejectedValueOnce(new Error("Backlink data from DataForSEO is switched off. Enable it."));
    expect(await lookupBacklinks({ clientId: 1, spend: true })).toMatchObject({ ok: false, kind: "disabled" });
  });

  it("returns a message, not a throw, for service failures", async () => {
    metrics.getKeywordMetrics.mockRejectedValueOnce(new Error("boom"));
    expect(await lookupKeywords({ clientId: 1, keywords: "a", spend: true })).toEqual({ ok: false, kind: "other", error: "boom" });
  });
});

describe("market-data actions: results", () => {
  it("serialises dates and reports pending standard-queue requests", async () => {
    metrics.getKeywordMetrics.mockResolvedValue({
      status: "pending",
      requestId: 9,
      items: [{ keyword: "a", volume: null, cpc: null, competition: null, trend: null, source: "estimate", fetchedAt: new Date("2026-01-02T00:00:00Z"), cached: false }],
    });
    const r = await lookupKeywords({ clientId: 1, keywords: "a", spend: true });
    expect(r).toMatchObject({ ok: true, status: "pending", requestId: 9 });
    if (r.ok) expect(r.items[0].fetchedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("pollRequest collects tasks then reads the request for this client", async () => {
    svc.pollPendingRequests.mockResolvedValue({ checked: 1, completed: 1, failed: 0 });
    svc.getRequest.mockResolvedValue({
      id: 4, kind: "volume", status: "ready", error: null,
      data: { rows: [{ keyword: "a", volume: 10, cpc: 1, competition: 0.1, trend: [1, 2], source: "dataforseo", fetchedAt: new Date("2026-01-02T00:00:00Z") }], missing: [] },
    });
    const r = await pollRequest({ clientId: 2, requestId: 4 });
    expect(svc.getRequest).toHaveBeenCalledWith(4, 2);
    expect(r).toMatchObject({ ok: true, status: "ready" });
  });
});
