import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ role: "owner" as "owner" | "manager" }));
const needs: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/action-guard", async () => {
  class ActionForbiddenError extends Error {}
  return {
    ActionForbiddenError,
    guardAction: async (need: string) => {
      needs.push(need);
      if (need === "settings" && st.role !== "owner") throw new ActionForbiddenError("Only the workspace owner can change this.");
    },
  };
});
const cfg = vi.hoisted(() => ({ saveCredentials: vi.fn(), clearCredentials: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/ext/dataforseo/config", () => cfg);
vi.mock("@/ext/dataforseo/endpoints/account", () => ({ getBalance: vi.fn(async () => ({ balanceUsd: 12.5, totalDepositedUsd: 20 })) }));

import { EncryptionUnavailableError } from "@/ext/crypto/encrypt-strict";
import { removeDfsCredentials, saveDfsCredentials, saveDfsSettings, testDfsConnection } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  st.role = "owner";
  needs.length = 0;
  vi.clearAllMocks();
});

describe("settings/dataforseo actions", () => {
  it("require the settings (owner) permission", async () => {
    await saveDfsCredentials(null, fd({ login: "a", password: "b" }));
    await removeDfsCredentials();
    await testDfsConnection();
    await saveDfsSettings(null, fd({ teamCapUsd: "10" }));
    expect(needs).toEqual(["settings", "settings", "settings", "settings"]);
  });

  it("refuse a non-owner before touching anything", async () => {
    st.role = "manager";
    await expect(saveDfsCredentials(null, fd({ login: "a", password: "b" }))).rejects.toThrow(/owner/);
    await expect(removeDfsCredentials()).rejects.toThrow();
    await expect(testDfsConnection()).rejects.toThrow();
    await expect(saveDfsSettings(null, fd({ teamCapUsd: "10" }))).rejects.toThrow();
    expect(cfg.saveCredentials).not.toHaveBeenCalled();
    expect(cfg.clearCredentials).not.toHaveBeenCalled();
    expect(cfg.saveSettings).not.toHaveBeenCalled();
  });

  it("never echoes the password back, and explains missing encryption", async () => {
    cfg.saveCredentials.mockRejectedValueOnce(new EncryptionUnavailableError());
    const r = await saveDfsCredentials(null, fd({ login: "a", password: "hunter2-secret" }));
    expect(r).toEqual({ ok: false, error: "Set SEO_ENCRYPTION_KEY — credentials are never stored unencrypted." });
    cfg.saveCredentials.mockResolvedValueOnce(undefined);
    expect(JSON.stringify(await saveDfsCredentials(null, fd({ login: "a", password: "hunter2-secret" })))).not.toContain("hunter2");
  });

  it("reports the balance on test connection", async () => {
    expect(await testDfsConnection()).toEqual({ ok: true, message: "Connected. Account balance: $12.50." });
  });

  it("parses caps, an unset team cap and per-user caps", async () => {
    await saveDfsSettings(null, fd({ teamCapUsd: "", userCap_3: "5", userCap_4: "", defaultMode: "live", backlinksEnabled: "on" }));
    expect(cfg.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ teamCapUsd: null, userCaps: { "3": 5 }, defaultMode: "live", backlinksEnabled: true, automationsMaySpend: false }),
    );
    const bad = await saveDfsSettings(null, fd({ teamCapUsd: "abc" }));
    expect(bad.ok).toBe(false);
  });
});
