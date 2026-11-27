import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const logActivity = vi.fn();
vi.mock("@/lib/mailer", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));

import { checkAlerts, currentAlerts } from "./alerts";
import { reserve, settle } from "./budget";
import { saveSettings } from "./config";
import { resetExtTables } from "./test-utils";

const base = { userId: 1, clientId: 1, endpoint: "search_volume" as const, mode: "live" as const, units: 1 };

beforeEach(() => {
  resetExtTables();
  sendMail.mockReset().mockResolvedValue({ ok: true });
  logActivity.mockReset().mockResolvedValue(undefined);
});

describe("alerts", () => {
  it("fires 80% once, then 100% once, never twice in a month", async () => {
    await saveSettings({ teamCapUsd: 1 });
    const a = await reserve({ ...base, estimatedMicros: 100 });
    settle(a.id, 750_000);
    expect(await checkAlerts({ userId: 1 })).toHaveLength(0);
    const b = await reserve({ ...base, estimatedMicros: 100 });
    settle(b.id, 60_000); // 81%
    expect((await checkAlerts({ userId: 1 })).map((x) => x.threshold)).toEqual([80]);
    expect(await checkAlerts({ userId: 1 })).toHaveLength(0);
    const c = await reserve({ ...base, estimatedMicros: 100 });
    settle(c.id, 190_000); // 100%
    expect((await checkAlerts({ userId: 1 })).map((x) => x.threshold)).toEqual([100]);
    expect(await checkAlerts({ userId: 1 })).toHaveLength(0);
    expect(logActivity).toHaveBeenCalledTimes(2);
    expect(currentAlerts().map((x) => x.threshold).sort((a, b) => a - b)).toEqual([80, 100]);
  });

  it("alerts per user when a user cap is set", async () => {
    await saveSettings({ teamCapUsd: 100, userCaps: { "1": 1 } });
    const a = await reserve({ ...base, estimatedMicros: 100 });
    settle(a.id, 900_000);
    const raised = await checkAlerts({ userId: 1 });
    expect(raised.map((r) => r.scope)).toEqual(["user:1"]);
  });

  it("email failure never throws", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    await saveSettings({ teamCapUsd: 1 });
    const a = await reserve({ ...base, estimatedMicros: 100 });
    settle(a.id, 900_000);
    await expect(checkAlerts({ userId: 1 })).resolves.toHaveLength(1);
  });
});
