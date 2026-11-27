import { describe, expect, it } from "vitest";
import { fixture } from "../test-utils";
import { mapVolumeResult } from "./volume";
import { mapIdeasResult, mapRankedResult } from "./labs";
import { bareDomain, mapBacklinks, mapIntersection, mapReferringDomains, mapSummary } from "./backlinks";
import { mapCompetitorsResult, mapDifficultyResult, mapDomainOverviewResult, mapIntentResult, mapRelevantPagesResult } from "./labs";
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
  it("maps difficulty, intent, overview, pages and competitors", () => {
    expect(mapDifficultyResult(task("labs_bulk_difficulty.json"))).toEqual([
      { keyword: "seo tool", difficulty: 71 }, { keyword: "free rank tracker", difficulty: 38 }, { keyword: "obscure term", difficulty: null },
    ]);
    const intent = mapIntentResult(task("labs_search_intent.json"));
    expect(intent[0]).toEqual({ keyword: "buy seo tool", intent: "transactional", probability: 0.82, secondary: [{ intent: "commercial", probability: 0.15 }] });
    expect(intent[1].secondary).toEqual([]);
    expect(mapDomainOverviewResult(task("labs_domain_overview.json"), "example.com")).toEqual({
      target: "example.com", organicKeywords: 290, etv: 1234.5,
      positions: { pos1: 10, pos2_3: 20, pos4_10: 50, pos11_20: 80, pos21_50: 90, pos51_100: 40 },
    });
    expect(mapDomainOverviewResult({ result: null } as never, "x.test")).toEqual({ target: "x.test", organicKeywords: null, etv: null, positions: null });
    const pages = mapRelevantPagesResult(task("labs_relevant_pages.json"));
    expect(pages.total).toBe(300);
    expect(pages.items[0]).toEqual({ url: "https://example.com/widget", etv: 512.3, keywords: 40 });
    const comp = mapCompetitorsResult(task("labs_competitors_domain.json"));
    expect(comp.items[0]).toEqual({ domain: "rival.test", intersections: 120, etv: 8000.5, keywords: 900 });
    expect(comp.items[1].etv).toBeNull();
  });
});
