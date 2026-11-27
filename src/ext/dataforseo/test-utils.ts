/* eslint-disable @typescript-eslint/no-explicit-any -- test helper */
/** Shared helpers for ext tests. Never touches the network. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { sqlite } from "@/db/client";
import { configureClient } from "./client";

export const FAKE_LOGIN = "fake-login@example.invalid";
export const FAKE_PASSWORD = "fake-password-not-real";

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "dataforseo", name), "utf-8")) as T;
}

export function useFakeCreds() {
  process.env.DATAFORSEO_LOGIN = FAKE_LOGIN;
  process.env.DATAFORSEO_PASSWORD = FAKE_PASSWORD;
  configureClient({ retryBaseMs: 0 });
}

export function resetExtTables() {
  for (const t of ["ext_keyword_metrics", "ext_dfs_cache", "ext_dfs_ledger", "ext_dfs_requests", "ext_dfs_alerts", "ext_mcp_tokens"]) {
    sqlite.exec(`DELETE FROM ${t}`);
  }
  sqlite.exec("DELETE FROM workspace_settings WHERE key LIKE 'dataforseo.%'");
}

export type Route = (url: string, init: RequestInit) => unknown | Response | Promise<unknown | Response>;

/** Stub global fetch. Routes are matched by URL substring, first match wins. */
export function mockFetch(routes: Record<string, Route>) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, init, body });
    for (const [k, handler] of Object.entries(routes)) {
      if (u.includes(k)) {
        const r = await handler(u, init);
        if (r instanceof Response) return r;
        return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    throw new Error("unmocked fetch " + u);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}
