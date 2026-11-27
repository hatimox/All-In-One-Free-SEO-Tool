import { beforeEach, describe, expect, it, vi } from "vitest";

const getKeywordMetrics = vi.fn();
const isConfigured = vi.fn();
const keywordDifficulty = vi.fn();
const searchIntent = vi.fn();
vi.mock("./keyword-metrics", () => ({ getKeywordMetrics: (...a: unknown[]) => getKeywordMetrics(...a) }));
vi.mock("../dataforseo/config", () => ({ isConfigured: () => isConfigured() }));
vi.mock("../dataforseo/service", () => ({
  keywordDifficulty: (...a: unknown[]) => keywordDifficulty(...a),
  searchIntent: (...a: unknown[]) => searchIntent(...a),
}));

import { BudgetError } from "../dataforseo/budget";
import { getKeywordOverview } from "./keyword-overview";

const base = { clientId: 1, keyword: "Alpha", allowSpend: true };
const ready = (data: unknown) => ({ status: "ready", requestId: 1, data, cached: false, fetchedAt: new Date(), costUsd: 0 });

beforeEach(() => {
  for (const m of [getKeywordMetrics, isConfigured, keywordDifficulty, searchIntent]) m.mockReset();
  getKeywordMetrics.mockResolvedValue({ status: "ready", items: [{ keyword: "alpha", source: "estimate" }] });
  isConfigured.mockResolvedValue(true);
});

describe("getKeywordOverview", () => {
  it("not configured -> free-estimate marker and null intent", async () => {
    isConfigured.mockResolvedValue(false);
    const r = await getKeywordOverview(base);
    expect(r.difficulty).toMatchObject({ source: "estimate", difficulty: null, needsFreeEstimate: true });
    expect(r.intent).toMatchObject({ source: null, intent: null });
    expect(keywordDifficulty).not.toHaveBeenCalled();
  });

  it("combines DataForSEO difficulty and intent", async () => {
    keywordDifficulty.mockResolvedValue(ready({ items: [{ keyword: "alpha", difficulty: 55 }] }));
    searchIntent.mockResolvedValue(ready({ items: [{ keyword: "alpha", intent: "commercial", probability: 0.7, secondary: [] }] }));
    const r = await getKeywordOverview(base);
    expect(r.difficulty).toMatchObject({ source: "dataforseo", difficulty: 55 });
    expect(r.intent).toMatchObject({ source: "dataforseo", intent: "commercial" });
  });

  it("cache miss without spending falls back with a reason", async () => {
    keywordDifficulty.mockResolvedValue({ status: "cache_miss" });
    searchIntent.mockResolvedValue({ status: "cache_miss" });
    const r = await getKeywordOverview({ ...base, allowSpend: false });
    expect(keywordDifficulty.mock.calls[0][0]).toMatchObject({ cacheOnly: true });
    expect(r.difficulty).toMatchObject({ needsFreeEstimate: true, fallbackReason: expect.stringMatching(/not cached/) });
    expect(r.intent.fallbackReason).toBeTruthy();
  });

  it("budget errors are thrown when spending was requested, swallowed otherwise", async () => {
    keywordDifficulty.mockRejectedValue(new BudgetError("cap", "team", 1, 1));
    searchIntent.mockResolvedValue({ status: "cache_miss" });
    await expect(getKeywordOverview(base)).rejects.toBeInstanceOf(BudgetError);
    const r = await getKeywordOverview({ ...base, allowSpend: false });
    expect(r.difficulty.fallbackReason).toMatch(/unavailable/);
  });
});
