import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, detectInput, filterIdeas, isQuestion, researchHref, toCsv } from "./research-input";
import { estimateDomainMissing, estimateKeywordMissing } from "./research-estimates";

describe("detectInput", () => {
  it("treats URLs and dotted single tokens as domains", () => {
    expect(detectInput("https://www.Example.com/path?x=1")).toEqual({ type: "domain", value: "example.com" });
    expect(detectInput("example.com")).toEqual({ type: "domain", value: "example.com" });
    expect(detectInput("blog.example.co.uk/page")).toEqual({ type: "domain", value: "blog.example.co.uk" });
  });
  it("treats everything else as a keyword", () => {
    expect(detectInput("vegan cookbooks")).toEqual({ type: "keyword", value: "vegan cookbooks" });
    expect(detectInput("node.js tutorial")).toEqual({ type: "keyword", value: "node.js tutorial" });
    expect(detectInput("seo")).toEqual({ type: "keyword", value: "seo" });
    expect(detectInput("   ")).toBeNull();
  });
  it("builds a client-scoped href", () => {
    expect(researchHref(3, { type: "keyword", value: "a b" }, "US")).toBe("/market-data/c/3/keyword?q=a+b&country=US");
    expect(researchHref(3, { type: "domain", value: "a.com" })).toBe("/market-data/c/3/domain?d=a.com");
  });
});

describe("helpers", () => {
  it("detects questions", () => {
    expect(isQuestion("how to bake bread")).toBe(true);
    expect(isQuestion("bread recipe")).toBe(false);
  });
  it("escapes CSV and guards formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", 'q"r'], ["=SUM(1)", 5]])).toBe('a,b\r\n"x,y","q""r"\r\n\'=SUM(1),5');
  });
  it("filters ideas", () => {
    const items = [
      { keyword: "red shoes", volume: 100, cpc: null, competition: null, difficulty: 20, intent: null, trend: null },
      { keyword: "blue shoes", volume: 10, cpc: null, competition: null, difficulty: 60, intent: null, trend: null },
    ];
    expect(filterIdeas(items, { ...EMPTY_FILTERS, minVol: "50" })).toHaveLength(1);
    expect(filterIdeas(items, { ...EMPTY_FILTERS, maxDiff: "30" })[0].keyword).toBe("red shoes");
    expect(filterIdeas(items, { ...EMPTY_FILTERS, include: "shoes", exclude: "red" })[0].keyword).toBe("blue shoes");
  });
});

describe("estimates", () => {
  it("sums only the missing parts", () => {
    const all = estimateKeywordMissing({ mode: "live", haveVolume: false, haveDifficulty: false, haveIntent: false, haveSuggestions: false, haveRelated: false });
    expect(all.parts).toHaveLength(5);
    const none = estimateKeywordMissing({ mode: "live", haveVolume: true, haveDifficulty: true, haveIntent: true, haveSuggestions: true, haveRelated: true });
    expect(none).toEqual({ micros: 0, parts: [] });
    const some = estimateKeywordMissing({ mode: "live", haveVolume: true, haveDifficulty: false, haveIntent: true, haveSuggestions: true, haveRelated: true });
    expect(some.parts).toEqual(["difficulty"]);
    expect(some.micros).toBeGreaterThan(0);
    expect(some.micros).toBeLessThan(all.micros);
    expect(estimateDomainMissing({ haveOverview: true, havePages: true, haveKeywords: true, haveCompetitors: true }).micros).toBe(0);
  });
});
