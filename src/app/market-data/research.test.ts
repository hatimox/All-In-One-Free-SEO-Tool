import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getKeywordOverview: vi.fn(),
  keywordIdeas: vi.fn(),
  domainOverview: vi.fn(),
  topPages: vi.fn(),
  rankedKeywords: vi.fn(),
  domainCompetitors: vi.fn(),
  backlinksSummary: vi.fn(),
}));
vi.mock("@/ext/providers/keyword-overview", () => ({ getKeywordOverview: m.getKeywordOverview }));
vi.mock("@/ext/dataforseo/service", () => m);
vi.mock("@/ext/dataforseo/config", () => ({
  isConfigured: async () => true,
  getSettings: async () => ({ defaultMode: "live", backlinksEnabled: true }),
}));
vi.mock("@/ext/dataforseo/market", async () => {
  const real = await vi.importActual<typeof import("@/ext/dataforseo/market")>("@/ext/dataforseo/market");
  return { ...real, marketForClient: async () => ({ country: "US", language: "en", locationCode: 2840, languageCode: "en" }) };
});

import { loadDomainView, loadKeywordView } from "./research";

const overview = {
  keyword: "seo",
  metrics: null,
  metricsStatus: "ready",
  difficulty: { source: "estimate", difficulty: null, needsFreeEstimate: true },
  intent: { source: null, intent: null, probability: null, secondary: [] },
};

beforeEach(() => vi.clearAllMocks());

describe("loadKeywordView", () => {
  it("opens cache-only: never allows spend and prices the missing parts", async () => {
    m.getKeywordOverview.mockResolvedValue(overview);
    m.keywordIdeas.mockResolvedValue({ status: "cache_miss" });
    const v = await loadKeywordView({ clientId: 1, keyword: " SEO ", spend: false });
    expect(m.getKeywordOverview).toHaveBeenCalledWith(expect.objectContaining({ keyword: "seo", allowSpend: false }));
    expect(m.keywordIdeas).toHaveBeenCalledTimes(2);
    for (const c of m.keywordIdeas.mock.calls) expect(c[0]).toMatchObject({ cacheOnly: true });
    expect(v.missing.parts).toEqual(["volume", "difficulty", "intent", "suggestions", "related ideas"]);
    expect(v.missing.micros).toBeGreaterThan(0);
  });

  it("surfaces a pending standard-queue request", async () => {
    m.getKeywordOverview.mockResolvedValue({ ...overview, metricsStatus: "pending", requestId: 12 });
    m.keywordIdeas.mockResolvedValue({ status: "cache_miss" });
    expect((await loadKeywordView({ clientId: 1, keyword: "seo", spend: true })).pendingRequestId).toBe(12);
  });
});

describe("loadDomainView", () => {
  it("opens cache-only and treats a not-yet-looked-up domain as a miss", async () => {
    m.domainOverview.mockRejectedValue(new Error('Cached data is only readable for this client\'s own domain or its competitors; "x.com" is neither.'));
    m.topPages.mockResolvedValue({ status: "cache_miss" });
    m.rankedKeywords.mockResolvedValue({ status: "cache_miss" });
    m.domainCompetitors.mockResolvedValue({ status: "cache_miss" });
    m.backlinksSummary.mockResolvedValue({ status: "cache_miss" });
    const v = await loadDomainView({ clientId: 1, domain: "x.com", spend: false });
    expect(v.overview.status).toBe("miss");
    expect(m.topPages).toHaveBeenCalledWith(expect.objectContaining({ cacheOnly: true, target: "x.com" }));
    expect(v.missing.parts).toHaveLength(4);
  });
});
