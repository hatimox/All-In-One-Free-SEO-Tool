import { describe, expect, it } from "vitest";
import { fixture } from "../test-utils";
import { mapVolumeResult } from "./volume";
import { mapIdeasResult, mapRankedResult } from "./labs";
import { bareDomain, mapBacklinks, mapIntersection, mapReferringDomains, mapSummary } from "./backlinks";
import { mapUserData } from "./account";

const task = (f: string) => fixture(f).tasks[0];

describe("response mappers", () => {
  it("maps volume rows, caps trend at 12 months oldest first, null-safe", () => {
    const rows = mapVolumeResult(task("volume_live.json"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ keyword: "seo tool", volume: 12100, cpc: 3.1, competitionIndex: 87, lowBid: 1.2, highBid: 5.4 });
    expect(rows[0].competition).toBeCloseTo(0.87);
    expect(rows[0].trend).toHaveLength(12);
    expect(rows[0].trend![0]).toBe(12500); // 2024-12 oldest after dropping 2024-11
    expect(rows[0].trend![11]).toBe(13000);
    expect(rows[1]).toMatchObject({ volume: null, cpc: null, competition: null, trend: null });
  });
  it("maps labs ideas and ranked keywords", () => {
    const ideas = mapIdeasResult(task("labs_ideas.json"));
    expect(ideas.total).toBe(2);
    expect(ideas.items[0]).toMatchObject({ keyword: "best seo tools", volume: 5400, difficulty: 62, intent: "commercial" });
    expect(ideas.items[1].volume).toBeNull();
    const ranked = mapRankedResult(task("labs_ranked.json"));
    expect(ranked.total).toBe(1500);
    expect(ranked.items[0]).toMatchObject({ keyword: "example widget", position: 4, url: "https://example.com/widget", volume: 880 });
  });
  it("maps backlinks endpoints", () => {
    expect(mapSummary(task("backlinks_summary.json"))).toMatchObject({ backlinks: 1200, referringDomains: 80, rank: 410, spamScore: 6 });
    const bl = mapBacklinks(task("backlinks_list.json"));
    expect(bl.total).toBe(2);
    expect(bl.items[0]).toMatchObject({ urlFrom: "https://blog.test/post", dofollow: true, isLost: false });
    expect(mapReferringDomains(task("referring_domains.json")).items[0]).toMatchObject({ domain: "blog.test", backlinks: 4 });
    expect(mapIntersection(task("backlinks_gap.json")).items[0]).toEqual({ domain: "news.test", intersections: 2, rank: 600, backlinks: 5 });
  });
  it("maps user_data balance", () => {
    expect(mapUserData(task("user_data.json"))).toEqual({ balanceUsd: 42.5, totalDepositedUsd: 50 });
  });
  it("strips scheme, www and path from domains", () => {
    expect(bareDomain("https://www.Example.com/a?b")).toBe("example.com");
  });
});
