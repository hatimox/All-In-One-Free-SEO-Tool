import { beforeEach, describe, expect, it } from "vitest";
import { sqlite } from "@/db/client";
import { BudgetError, monthlySpend, recordCacheHit, release, reserve, settle } from "./budget";
import { saveSettings } from "./config";
import { estimateMicros } from "./pricing";
import { resetExtTables } from "./test-utils";

const base = { userId: 1, clientId: 7, endpoint: "search_volume" as const, mode: "live" as const, units: 1 }; // $0.09

beforeEach(resetExtTables);

describe("budget", () => {
  it("blocks every paid call until a team cap is set", async () => {
    await expect(reserve(base)).rejects.toMatchObject({ name: "BudgetError", scope: "team_unset" });
  });

  it("blocks when the team cap would be exceeded, message has spent/cap", async () => {
    await saveSettings({ teamCapUsd: 0.1 });
    const r = await reserve(base);
    const err = await reserve(base).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetError);
    expect(err.scope).toBe("team");
    expect(err.message).toMatch(/\$0\.0900 of \$0\.10/);
    expect(r.estimatedMicros).toBe(90_000);
  });

  it("enforces a per-user cap but lets other users through", async () => {
    await saveSettings({ teamCapUsd: 10, userCaps: { "1": 0.1 } });
    await reserve(base);
    await expect(reserve(base)).rejects.toMatchObject({ scope: "user" });
    await expect(reserve({ ...base, userId: 2 })).resolves.toBeTruthy();
  });

  it("enforces the per-request maximum (default $1)", async () => {
    await saveSettings({ teamCapUsd: 100 });
    await expect(reserve({ ...base, units: 20 })).rejects.toMatchObject({ scope: "request" }); // 20 * 0.09 = 1.80
    await saveSettings({ requestMaxUsd: 5 });
    await expect(reserve({ ...base, units: 20 })).resolves.toBeTruthy();
  });

  it("settle uses actual cost; release frees the reservation", async () => {
    await saveSettings({ teamCapUsd: 0.2 });
    const a = await reserve(base);
    expect(monthlySpend().totalMicros).toBe(90_000);
    expect(settle(a.id, 20_000)!.actualMicros).toBe(20_000);
    expect(monthlySpend().totalMicros).toBe(20_000);
    expect(settle(a.id, 99)).toBeNull(); // idempotent
    const b = await reserve(base);
    expect(release(b.id)).toBe(true);
    expect(monthlySpend().totalMicros).toBe(20_000);
    expect(release(b.id)).toBe(false);
  });

  it("two concurrent reserves cannot both pass when only one fits", async () => {
    await saveSettings({ teamCapUsd: 0.1 });
    const results = await Promise.allSettled([reserve(base), reserve(base), reserve(base)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const n = sqlite.prepare("SELECT COUNT(*) AS n FROM ext_dfs_ledger").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("previous months do not count", async () => {
    await saveSettings({ teamCapUsd: 0.1 });
    const a = await reserve(base);
    sqlite.prepare("UPDATE ext_dfs_ledger SET created_at = ? WHERE id = ?").run(Date.UTC(2020, 0, 1), a.id);
    await expect(reserve(base)).resolves.toBeTruthy();
  });

  it("cache hits cost nothing and show up as savings", async () => {
    await saveSettings({ teamCapUsd: 1 });
    recordCacheHit({ userId: 1, clientId: 7, endpoint: "search_volume", mode: "live", savedMicros: 90_000 });
    const s = monthlySpend();
    expect(s.totalMicros).toBe(0);
    expect(s.cacheHits).toBe(1);
    expect(s.savedMicros).toBe(90_000);
  });

  it("summarizes by user, client and endpoint; can filter by user", async () => {
    await saveSettings({ teamCapUsd: 10 });
    const a = await reserve(base);
    settle(a.id, 50_000);
    const b = await reserve({ ...base, userId: 2, clientId: 8, endpoint: "labs_keyword_ideas", units: 100 });
    settle(b.id, 10_000);
    const s = monthlySpend();
    expect(s.totalMicros).toBe(60_000);
    expect(s.byUser.map((u) => u.userId).sort()).toEqual([1, 2]);
    expect(s.byEndpoint).toHaveLength(2);
    expect(monthlySpend({ userId: 2 }).totalMicros).toBe(10_000);
  });
});

describe("pricing", () => {
  it("rounds up and is per task for volume", () => {
    expect(estimateMicros("search_volume", "standard", 2)).toBe(120_000);
    expect(estimateMicros("labs_keyword_ideas", "live", 200)).toBe(12_000 + 24_000);
    expect(estimateMicros("backlinks_list", "live", 1000)).toBe(24_000 + 36_000);
    expect(estimateMicros("user_data", "live", 1)).toBe(0);
  });
});
