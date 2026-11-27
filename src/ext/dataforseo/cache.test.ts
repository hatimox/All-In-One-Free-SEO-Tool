import { beforeEach, describe, expect, it } from "vitest";
import { cacheKeyFor, getCachedMetrics, getCachedResponse, normalizeKeywords, putCachedResponse, putMetrics } from "./cache";
import { saveSettings } from "./config";
import { resetExtTables } from "./test-utils";

const m = { locationCode: 2840, languageCode: "en" };
const row = (keyword: string, volume: number | null = 10) => ({
  keyword, volume, cpc: 1, competition: 0.5, competitionIndex: 50, lowBid: 1, highBid: 2, trend: [1, 2],
});

beforeEach(resetExtTables);

describe("cache", () => {
  it("normalizes and dedupes keywords", () => {
    expect(normalizeKeywords(["  Foo  Bar", "foo bar", "", "Baz"])).toEqual(["foo bar", "baz"]);
  });
  it("cache key is order-insensitive for object keys and stable", () => {
    expect(cacheKeyFor("e", { a: 1, b: 2 })).toBe(cacheKeyFor("e", { b: 2, a: 1 }));
    expect(cacheKeyFor("e", { a: 1 })).not.toBe(cacheKeyFor("e2", { a: 1 }));
  });
  it("returns hits and only the misses of a partial batch", async () => {
    await putMetrics([row("a"), row("b", null)], m);
    const r = await getCachedMetrics(["A", "b", "c"], m);
    expect([...r.hits.keys()].sort()).toEqual(["a", "b"]);
    expect(r.hits.get("b")!.volume).toBeNull(); // known-empty is still a hit
    expect(r.misses).toEqual(["c"]);
    expect(r.hits.get("a")!.trend).toEqual([1, 2]);
  });
  it("is scoped by market and source", async () => {
    await putMetrics([row("a")], m);
    expect((await getCachedMetrics(["a"], { ...m, locationCode: 2826 })).misses).toEqual(["a"]);
    expect((await getCachedMetrics(["a"], { ...m, source: "other" })).misses).toEqual(["a"]);
  });
  it("expires after the TTL", async () => {
    const t0 = Date.now();
    await putMetrics([row("a")], m, t0);
    expect((await getCachedMetrics(["a"], m, t0 + 29 * 86_400_000)).misses).toEqual([]);
    expect((await getCachedMetrics(["a"], m, t0 + 31 * 86_400_000)).misses).toEqual(["a"]);
  });
  it("honours ttl_days from settings", async () => {
    await saveSettings({ ttlDays: { volume: 1, labs: 1, backlinks: 1 } });
    const t0 = Date.now();
    await putMetrics([row("a")], m, t0);
    expect((await getCachedMetrics(["a"], m, t0 + 2 * 86_400_000)).misses).toEqual(["a"]);
  });
  it("generic response cache with TTL", async () => {
    const t0 = Date.now();
    await putCachedResponse("k", "ep", { x: 1 }, 5, "labs", t0);
    expect((await getCachedResponse<{ x: number }>("k", t0 + 1000))!.data.x).toBe(1);
    expect(await getCachedResponse("k", t0 + 15 * 86_400_000)).toBeNull();
  });
});
