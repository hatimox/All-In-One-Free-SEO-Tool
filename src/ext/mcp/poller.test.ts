import { beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "@/db/client";
import { resetExtTables } from "../dataforseo/test-utils";

const poll = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../dataforseo/service", () => ({ pollPendingRequests: poll.fn }));

const { tickDfsPoller, hasPendingRequests } = await import("./poller");

const addPending = () =>
  sqlite
    .prepare("INSERT INTO ext_dfs_requests (kind, params_json, status, created_at) VALUES ('volume','{}','pending',?)")
    .run(Date.now());

beforeEach(() => {
  resetExtTables();
  sqlite.exec("DELETE FROM ext_dfs_requests");
  poll.fn.mockReset();
  poll.fn.mockResolvedValue({ checked: 1, completed: 1, failed: 0 });
});

describe("dfs poller", () => {
  it("does nothing when nothing is pending", async () => {
    expect(hasPendingRequests()).toBe(false);
    expect(await tickDfsPoller()).toEqual({ skipped: "idle" });
    expect(poll.fn).not.toHaveBeenCalled();
  });

  it("polls when a volume request is pending", async () => {
    addPending();
    expect(await tickDfsPoller()).toMatchObject({ completed: 1 });
    expect(poll.fn).toHaveBeenCalledTimes(1);
  });

  it("does not overlap itself", async () => {
    addPending();
    let release!: () => void;
    poll.fn.mockReturnValue(new Promise((r) => (release = () => r({ checked: 1, completed: 0, failed: 0 }))));
    const first = tickDfsPoller();
    expect(await tickDfsPoller()).toEqual({ skipped: "overlap" });
    release();
    await first;
    expect(poll.fn).toHaveBeenCalledTimes(1);
    poll.fn.mockResolvedValue({ checked: 1, completed: 0, failed: 0 });
    await tickDfsPoller(); // runnable again afterwards
    expect(poll.fn).toHaveBeenCalledTimes(2);
  });

  it("releases the lock when the poll throws", async () => {
    addPending();
    poll.fn.mockRejectedValueOnce(new Error("boom"));
    await expect(tickDfsPoller()).rejects.toThrow("boom");
    await expect(tickDfsPoller()).resolves.toMatchObject({ completed: 1 });
  });
});
