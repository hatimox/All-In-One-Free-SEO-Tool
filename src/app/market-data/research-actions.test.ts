import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ role: "owner" as "owner" | "viewer" }));
const guardCalls: [string, unknown][] = [];

vi.mock("@/lib/action-guard", async () => {
  class ActionForbiddenError extends Error {}
  return {
    ActionForbiddenError,
    guardAction: async (need: string, clientId?: unknown) => {
      guardCalls.push([need, clientId]);
      if ((need === "edit" || need === "settings") && st.role === "viewer") throw new ActionForbiddenError("You have read-only access.");
    },
  };
});
vi.mock("@/lib/client-scope", () => ({ clientScope: async () => undefined }));
vi.mock("@/ext/ui/market-access", () => ({ marketAccess: async () => ({ access: {}, settings: {} }) }));
vi.mock("@/ext/providers/keyword-metrics", () => ({ getKeywordMetrics: vi.fn() }));
vi.mock("@/ext/dataforseo/service", () => ({}));
const research = vi.hoisted(() => ({ loadKeywordView: vi.fn(), loadDomainView: vi.fn(), loadIdeas: vi.fn() }));
vi.mock("./research", () => research);
const serp = vi.hoisted(() => ({ scanSerp: vi.fn() }));
vi.mock("@/lib/serp-scanner", () => serp);
const diff = vi.hoisted(() => ({ estimateDifficulty: vi.fn() }));
vi.mock("@/app/tools/keyword-difficulty/actions", () => diff);
const track = vi.hoisted(() => ({ trackKeyword: vi.fn() }));
vi.mock("@/app/keywords/actions", () => track);

import { BudgetError } from "@/ext/dataforseo/budget";
import {
  estimateKeywordDifficulty,
  fetchDomainView,
  fetchIdeasView,
  fetchKeywordView,
  scanTopResults,
  trackKeywords,
} from "./actions";

beforeEach(() => {
  st.role = "owner";
  guardCalls.length = 0;
  vi.clearAllMocks();
});

describe("research actions: guards", () => {
  it("every action calls guardAction with the client id first", async () => {
    research.loadKeywordView.mockResolvedValue({});
    research.loadDomainView.mockResolvedValue({});
    research.loadIdeas.mockResolvedValue({ status: "miss" });
    serp.scanSerp.mockResolvedValue({ ok: true, topResults: [] });
    diff.estimateDifficulty.mockResolvedValue({ ok: false, error: "x" });
    await fetchKeywordView({ clientId: 4, keyword: "a", spend: false });
    await fetchDomainView({ clientId: 4, domain: "a.com", spend: false });
    await fetchIdeasView({ clientId: 4, seed: "a", variant: "ideas", spend: false });
    await scanTopResults({ clientId: 4, keyword: "a" });
    await estimateKeywordDifficulty({ clientId: 4, keyword: "a" });
    await trackKeywords({ clientId: 4, keywords: ["a"] });
    expect(guardCalls).toHaveLength(6);
    expect(guardCalls.every(([, id]) => id === 4)).toBe(true);
  });

  it("opening is cache only: spend:false needs read and the loader is told not to spend", async () => {
    research.loadKeywordView.mockResolvedValue({});
    research.loadDomainView.mockResolvedValue({});
    await fetchKeywordView({ clientId: 1, keyword: "a", spend: false });
    await fetchDomainView({ clientId: 1, domain: "a.com", spend: false });
    expect(guardCalls).toEqual([["read", 1], ["read", 1]]);
    expect(research.loadKeywordView).toHaveBeenCalledWith(expect.objectContaining({ spend: false }));
    expect(research.loadDomainView).toHaveBeenCalledWith(expect.objectContaining({ spend: false }));
  });

  it("a viewer cannot spend or scrape: the guard throws before any loader runs", async () => {
    st.role = "viewer";
    await expect(fetchKeywordView({ clientId: 1, keyword: "a", spend: true })).rejects.toThrow(/read-only/);
    await expect(fetchDomainView({ clientId: 1, domain: "a.com", spend: true })).rejects.toThrow();
    await expect(fetchIdeasView({ clientId: 1, seed: "a", variant: "ideas", spend: true })).rejects.toThrow();
    await expect(scanTopResults({ clientId: 1, keyword: "a" })).rejects.toThrow();
    await expect(estimateKeywordDifficulty({ clientId: 1, keyword: "a" })).rejects.toThrow();
    await expect(trackKeywords({ clientId: 1, keywords: ["a"] })).rejects.toThrow();
    expect(research.loadKeywordView).not.toHaveBeenCalled();
    expect(research.loadDomainView).not.toHaveBeenCalled();
    expect(research.loadIdeas).not.toHaveBeenCalled();
    expect(serp.scanSerp).not.toHaveBeenCalled();
    expect(track.trackKeyword).not.toHaveBeenCalled();
  });

  it("a viewer can still open from the cache", async () => {
    st.role = "viewer";
    research.loadKeywordView.mockResolvedValue({ keyword: "a" });
    expect(await fetchKeywordView({ clientId: 1, keyword: "a", spend: false })).toMatchObject({ ok: true });
  });

  it("maps a budget error from the paid fetch to a message", async () => {
    research.loadKeywordView.mockRejectedValueOnce(new BudgetError("Team DataForSEO budget reached", "team", 5, 5));
    expect(await fetchKeywordView({ clientId: 1, keyword: "a", spend: true })).toMatchObject({ ok: false, kind: "budget" });
  });
});

describe("research actions: behaviour", () => {
  it("trackKeywords de-duplicates and tracks each keyword for the client", async () => {
    const r = await trackKeywords({ clientId: 2, keywords: ["a", " a ", "b"], country: "GB" });
    expect(r).toEqual({ ok: true, tracked: 2 });
    expect(track.trackKeyword).toHaveBeenCalledTimes(2);
    const fd = track.trackKeyword.mock.calls[0][0] as FormData;
    expect(fd.get("clientId")).toBe("2");
    expect(fd.get("country")).toBe("GB");
  });

  it("scanTopResults returns title, url and domain for the top 10", async () => {
    serp.scanSerp.mockResolvedValue({
      ok: true,
      topResults: Array.from({ length: 12 }, (_, i) => ({ position: i + 1, title: `t${i}`, url: `https://x${i}.com/p`, domain: `x${i}.com`, snippet: null, isClient: false })),
    });
    const r = await scanTopResults({ clientId: 1, keyword: "seo" });
    expect(r.ok && r.results).toHaveLength(10);
    expect(serp.scanSerp).toHaveBeenCalledWith(expect.objectContaining({ query: "seo", topN: 10 }));
  });
});
