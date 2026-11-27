import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSettings } from "../dataforseo/config";
import { resetExtTables, useFakeCreds } from "../dataforseo/test-utils";

vi.mock("../dataforseo/service", () => ({
  backlinksSummary: vi.fn(async () => ({ status: "ready", cached: true, data: { backlinks: 5 } })),
  referringDomains: vi.fn(async () => ({ status: "ready", cached: true, data: { items: [{ domain: "a.test" }] } })),
}));
import { getBacklinkOverview } from "./backlinks";

beforeEach(() => {
  resetExtTables();
  useFakeCreds();
});

describe("getBacklinkOverview", () => {
  it("falls back to discovery when disabled", async () => {
    expect(await getBacklinkOverview({ clientId: 1, allowSpend: false })).toMatchObject({ source: "none", fallback: "discovery" });
  });
  it("falls back when enabled but not configured", async () => {
    await saveSettings({ backlinksEnabled: true });
    delete process.env.DATAFORSEO_LOGIN;
    expect(await getBacklinkOverview({ clientId: 1, allowSpend: false })).toMatchObject({ source: "none", fallback: "discovery" });
  });
  it("uses DataForSEO when enabled and configured", async () => {
    await saveSettings({ backlinksEnabled: true });
    const r = await getBacklinkOverview({ clientId: 1, allowSpend: false });
    expect(r).toMatchObject({ source: "dataforseo", status: "ready", referringDomains: [{ domain: "a.test" }] });
  });
});
