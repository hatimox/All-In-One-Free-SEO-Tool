import { describe, expect, it } from "vitest";
import { sourceBadgeLabel, sourceBadgeTitle } from "./source-badge-label";

describe("sourceBadgeLabel", () => {
  it("maps every data source to its user-facing label", () => {
    expect(sourceBadgeLabel("dataforseo")).toBe("DataForSEO");
    expect(sourceBadgeLabel("google_ads")).toBe("Keyword Planner");
    expect(sourceBadgeLabel("bing")).toBe("Bing impressions");
    expect(sourceBadgeLabel("estimate")).toBe("Estimate (relative)");
    expect(sourceBadgeLabel("gsc")).toBe("Search Console");
  });
  it("passes unknown sources through rather than hiding them", () => {
    expect(sourceBadgeLabel("mystery")).toBe("mystery");
  });
});

describe("sourceBadgeTitle", () => {
  it("includes provenance, date, cached marker and the fallback reason", () => {
    const t = sourceBadgeTitle({
      source: "estimate",
      fetchedAt: "2026-03-04T10:00:00Z",
      cached: true,
      fallbackReason: "DataForSEO result not cached and spending was not allowed",
    });
    expect(t).toMatch(/relative bucket/);
    expect(t).toMatch(/As of 2026-03-04/);
    expect(t).toMatch(/Cached/);
    expect(t).toMatch(/Why not DataForSEO: DataForSEO result not cached/);
  });
  it("marks provisional rows and omits absent parts", () => {
    const t = sourceBadgeTitle({ source: "bing", pending: true });
    expect(t).toMatch(/Provisional/);
    expect(t).not.toMatch(/As of|Cached/);
  });
});
