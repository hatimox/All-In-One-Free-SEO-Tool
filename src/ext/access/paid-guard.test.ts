import { beforeEach, describe, expect, it, vi } from "vitest";

let scope = true;
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!scope) throw new Error("no request scope");
    return new Headers();
  },
}));
const auth = {
  accountsEnabled: vi.fn(),
  currentUser: vi.fn(),
  canEdit: (r: string) => r !== "viewer",
  canSeeClient: vi.fn(),
};
vi.mock("@/lib/auth", () => auth);

import { saveSettings } from "../dataforseo/config";
import { resetExtTables } from "../dataforseo/test-utils";
import { guardPaid, PaidForbiddenError } from "./paid-guard";

beforeEach(() => {
  resetExtTables();
  scope = true;
  auth.accountsEnabled.mockReturnValue(true);
  auth.canSeeClient.mockResolvedValue(true);
});

describe("guardPaid", () => {
  it("allows when accounts are disabled (local mode), user null", async () => {
    auth.accountsEnabled.mockReturnValue(false);
    expect(await guardPaid(1)).toBeNull();
  });
  it("rejects signed-out and viewers", async () => {
    auth.currentUser.mockResolvedValue(null);
    await expect(guardPaid(1)).rejects.toBeInstanceOf(PaidForbiddenError);
    auth.currentUser.mockResolvedValue({ id: 5, role: "viewer" });
    await expect(guardPaid(1)).rejects.toThrow(/read-only/);
  });
  it("owner and manager pass, returning their id", async () => {
    for (const role of ["owner", "manager"]) {
      auth.currentUser.mockResolvedValue({ id: 3, role });
      expect(await guardPaid(1)).toBe(3);
    }
  });
  it("member must see the client", async () => {
    auth.currentUser.mockResolvedValue({ id: 4, role: "member" });
    expect(await guardPaid(1)).toBe(4);
    auth.canSeeClient.mockResolvedValue(false);
    await expect(guardPaid(2)).rejects.toThrow(/Client not found/);
  });
  it("background jobs need automations_may_spend", async () => {
    scope = false;
    await expect(guardPaid(1)).rejects.toThrow(/Automations/);
    await saveSettings({ automationsMaySpend: true });
    expect(await guardPaid(1)).toBeNull();
  });
});
