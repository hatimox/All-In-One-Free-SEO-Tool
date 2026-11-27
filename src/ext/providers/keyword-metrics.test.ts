import { beforeEach, describe, expect, it, vi } from "vitest";

const getVolumes = vi.fn();
const isConfigured = vi.fn();
const adsStatus = vi.fn();
const adsMetrics = vi.fn();
const bingKey = vi.fn();
const bingVolumes = vi.fn();
const estimateBulk = vi.fn();

vi.mock("../dataforseo/service", () => ({ getVolumes: (...a: unknown[]) => getVolumes(...a) }));
vi.mock("../dataforseo/config", () => ({ isConfigured: () => isConfigured() }));
const resolveMarket = vi.fn();
vi.mock("../dataforseo/market", () => ({
  marketForClient: async () => ({ country: "US", language: "en", locationCode: 2840, languageCode: "en" }),
  resolveMarket: (...a: unknown[]) => resolveMarket(...a),
}));
vi.mock("@/lib/google-ads", () => ({ getAdsStatus: () => adsStatus(), keywordMetrics: (...a: unknown[]) => adsMetrics(...a) }));
vi.mock("@/lib/bing-webmaster", () => ({ getBingApiKey: () => bingKey(), getBingKeywordVolumes: (...a: unknown[]) => bingVolumes(...a) }));
vi.mock("@/lib/search-volume", () => ({ estimateBulk: (...a: unknown[]) => estimateBulk(...a) }));

import { BudgetError } from "../dataforseo/budget";
import { DataForSeoError } from "../dataforseo/client";
import { PaidForbiddenError } from "../access/paid-guard";
import { getKeywordMetrics } from "./keyword-metrics";

const base = { clientId: 1, keywords: ["alpha"], allowSpend: true };

beforeEach(() => {
  for (const m of [getVolumes, isConfigured, adsStatus, adsMetrics, bingKey, bingVolumes, estimateBulk]) m.mockReset();
  resolveMarket.mockReset().mockReturnValue({ country: "US", language: "en", locationCode: 2840, languageCode: "en" });
  isConfigured.mockResolvedValue(false);
  adsStatus.mockResolvedValue({ ready: false });
  bingKey.mockResolvedValue(null);
  estimateBulk.mockImplementation(async (o: { queries: string[] }) => o.queries.map((q) => ({ query: q, bucket: "low" })));
});

describe("getKeywordMetrics fallback chain", () => {
  it("no credentials anywhere -> free estimate", async () => {
    const r = await getKeywordMetrics(base);
    expect(r.items[0]).toMatchObject({ source: "estimate", volume: null, volumeBucket: "low" });
    expect(getVolumes).not.toHaveBeenCalled();
  });

  it("DFS ready -> dataforseo, cached flag from fetch time", async () => {
    isConfigured.mockResolvedValue(true);
    getVolumes.mockResolvedValue({
      status: "ready", requestId: null, cached: 1, paid: 0, costUsd: 0,
      rows: [{ keyword: "alpha", volume: 500, cpc: 2, competition: 0.4, trend: [1], source: "dataforseo", fetchedAt: new Date(Date.now() - 86_400_000) }],
    });
    const r = await getKeywordMetrics(base);
    expect(r.items[0]).toMatchObject({ source: "dataforseo", volume: 500, cached: true });
  });

  it("when spending was asked for, budget / forbidden / funds / auth / ambiguous errors are surfaced, not hidden", async () => {
    isConfigured.mockResolvedValue(true);
    adsStatus.mockResolvedValue({ ready: true });
    adsMetrics.mockResolvedValue([{ text: "alpha", volume: 900, competitionIndex: 40, highBid: 1.5 }]);
    const errs = [
      new BudgetError("Team DataForSEO budget reached", "team", 5, 5),
      new PaidForbiddenError("nope"),
      new DataForSeoError("DataForSEO balance is empty", 40210, false),
      new DataForSeoError("bad creds", 40100, false),
      new DataForSeoError("timed out", null, true, true),
    ];
    for (const e of errs) {
      getVolumes.mockRejectedValueOnce(e);
      await expect(getKeywordMetrics(base)).rejects.toBe(e);
    }
  });

  it("cache-only reads and plain outages still fall back with fallbackReason", async () => {
    isConfigured.mockResolvedValue(true);
    adsStatus.mockResolvedValue({ ready: true });
    adsMetrics.mockResolvedValue([{ text: "alpha", volume: 900, competitionIndex: 40, highBid: 1.5 }]);
    getVolumes.mockRejectedValueOnce(new BudgetError("Team DataForSEO budget reached", "team", 5, 5));
    const r = await getKeywordMetrics({ ...base, allowSpend: false });
    expect(r.items[0]).toMatchObject({ source: "google_ads", volume: 900 });
    expect(r.items[0].fallbackReason).toMatch(/budget reached/);
    getVolumes.mockRejectedValueOnce(new DataForSeoError("DataForSEO error 50000: boom", 50000, true));
    const r2 = await getKeywordMetrics(base);
    expect(r2.items[0].fallbackReason).toMatch(/boom/);
  });

  it("an unsupported country override fails clearly instead of using the client's market", async () => {
    isConfigured.mockResolvedValue(true);
    resolveMarket.mockReturnValue(null);
    await expect(getKeywordMetrics({ ...base, market: { country: "ZZ" } })).rejects.toThrow(/Unsupported country "ZZ"/);
    expect(getVolumes).not.toHaveBeenCalled();
    // explicit codes bypass the lookup
    getVolumes.mockResolvedValue({ status: "ready", requestId: null, cached: 0, paid: 0, costUsd: 0, rows: [] });
    await expect(getKeywordMetrics({ ...base, market: { country: "ZZ", locationCode: 1, languageCode: "xx" } })).resolves.toBeTruthy();
  });

  it("ads ready without DFS -> google_ads; ads failing -> bing", async () => {
    adsStatus.mockResolvedValue({ ready: true });
    adsMetrics.mockResolvedValue([{ text: "alpha", volume: 10, competitionIndex: null, highBid: null }]);
    expect((await getKeywordMetrics(base)).items[0].source).toBe("google_ads");
    adsMetrics.mockRejectedValue(new Error("expired"));
    bingKey.mockResolvedValue("k");
    bingVolumes.mockResolvedValue(new Map([["alpha", 77]]));
    const r = await getKeywordMetrics(base);
    expect(r.items[0]).toMatchObject({ source: "bing", volume: 77 });
    expect(r.items[0].fallbackReason).toMatch(/Google Ads failed/);
  });

  it("cache_miss without spend allowed -> falls through, reason set; cacheOnly passed", async () => {
    isConfigured.mockResolvedValue(true);
    getVolumes.mockResolvedValue({ status: "cache_miss", rows: [], misses: ["alpha"] });
    const r = await getKeywordMetrics({ ...base, allowSpend: false });
    expect(getVolumes.mock.calls[0][0].cacheOnly).toBe(true);
    expect(r.items[0].source).toBe("estimate");
    expect(r.items[0].fallbackReason).toMatch(/not cached/);
  });

  it("pending standard task -> status pending, fallback value marked pending", async () => {
    isConfigured.mockResolvedValue(true);
    getVolumes.mockResolvedValue({ status: "pending", requestId: 42, rows: [], pendingKeywords: ["alpha"] });
    const r = await getKeywordMetrics(base);
    expect(r).toMatchObject({ status: "pending", requestId: 42 });
    expect(r.items[0]).toMatchObject({ source: "estimate", pending: true });
  });
});
