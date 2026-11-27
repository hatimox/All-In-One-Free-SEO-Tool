import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dfsRequest, DataForSeoError, INSUFFICIENT_FUNDS_MESSAGE, redact } from "./client";
import { saveCredentials, getCredentials, clearCredentials, credentialStatus } from "./config";
import { FAKE_LOGIN, FAKE_PASSWORD, fixture, mockFetch, resetExtTables, useFakeCreds } from "./test-utils";

beforeEach(() => {
  resetExtTables();
  useFakeCreds();
});
afterEach(() => vi.unstubAllGlobals());

const basic = () => "Basic " + Buffer.from(`${FAKE_LOGIN}:${FAKE_PASSWORD}`).toString("base64");

describe("dfs client", () => {
  it("sends basic auth and parses the envelope", async () => {
    const { calls } = mockFetch({ "/v3/appendix/user_data": () => fixture("user_data.json") });
    const env = await dfsRequest("GET", "/v3/appendix/user_data");
    expect(env.status_code).toBe(20000);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(basic());
  });

  it("retries on rate limit 40202 then succeeds", async () => {
    let n = 0;
    const { fn } = mockFetch({
      "/x": () => (++n < 3 ? { status_code: 40202, status_message: "rate", tasks: [] } : fixture("user_data.json")),
    });
    await dfsRequest("GET", "/x");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry insufficient funds and gives a clear message", async () => {
    const { fn } = mockFetch({ "/x": () => ({ status_code: 40210, status_message: "insufficient funds", tasks: [] }) });
    await expect(dfsRequest("GET", "/x")).rejects.toThrow(INSUFFICIENT_FUNDS_MESSAGE);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx and network errors, then gives up", async () => {
    const { fn } = mockFetch({ "/x": () => new Response("oops", { status: 503 }) });
    await expect(dfsRequest("GET", "/x")).rejects.toBeInstanceOf(DataForSeoError);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("never leaks credentials or the Authorization header in errors", async () => {
    mockFetch({
      "/x": () => {
        throw new Error(`boom Authorization: ${basic()} login=${FAKE_LOGIN} pw=${FAKE_PASSWORD}`);
      },
    });
    let msg = "";
    try {
      await dfsRequest("GET", "/x");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBeTruthy();
    for (const secret of [FAKE_PASSWORD, FAKE_LOGIN, Buffer.from(`${FAKE_LOGIN}:${FAKE_PASSWORD}`).toString("base64")]) {
      expect(msg).not.toContain(secret);
    }
  });

  it("redact() scrubs inline basic tokens even without known creds", () => {
    expect(redact("Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==")).not.toContain("QWxhZGRpbjpvcGVuIHNlc2FtZQ");
  });

  it("fails clearly when not configured", async () => {
    delete process.env.DATAFORSEO_LOGIN;
    await expect(dfsRequest("GET", "/x")).rejects.toThrow(/not configured/);
  });
});

describe("credential storage", () => {
  it("stores encrypted, reads back decrypted, clears", async () => {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    await saveCredentials({ login: FAKE_LOGIN, password: FAKE_PASSWORD });
    const { sqlite } = await import("@/db/client");
    const raw = sqlite.prepare("SELECT value FROM workspace_settings WHERE key='dataforseo.password'").get() as { value: string };
    expect(raw.value).not.toContain(FAKE_PASSWORD);
    expect(raw.value).toContain("enc:v1:");
    expect(await getCredentials()).toEqual({ login: FAKE_LOGIN, password: FAKE_PASSWORD });
    const st = await credentialStatus();
    expect(JSON.stringify(st)).not.toContain(FAKE_PASSWORD);
    expect(st.source).toBe("settings");
    await clearCredentials();
    expect(await getCredentials()).toBeNull();
  });
});
