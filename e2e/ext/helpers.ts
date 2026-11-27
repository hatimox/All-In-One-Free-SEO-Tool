import fs from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { AUTH_DIR, BASE_URL, MOCK_URL } from "./env.mjs";

export type Who = "owner" | "member" | "viewer";
export type Call = { method: string; path: string; body: unknown };

export const seed = (): { A: number; B: number } =>
  JSON.parse(fs.readFileSync(".e2e/ext-data/seed.json", "utf8"));

export async function pageAs(browser: Browser, who: Who): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    storageState: `${AUTH_DIR}/${who}.json`,
  });
  return ctx.newPage();
}

export async function mockCalls(): Promise<Call[]> {
  return (await fetch(`${MOCK_URL}/__calls`)).json();
}

export async function mockReset(): Promise<void> {
  await fetch(`${MOCK_URL}/__reset`, { method: "POST" });
}

/** Paid DataForSEO calls: anything that posts a task or runs a live query. */
export const paidCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && /\/(task_post|live)$/.test(c.path));

/** Owner sets the team cap (and default mode) through the Settings form. */
export async function setTeamCap(page: Page, cap: string, mode: "standard" | "live" = "standard") {
  await page.goto("/settings/dataforseo");
  await page.getByLabel("Team monthly cap (USD)").fill(cap);
  await page.getByLabel(mode === "live" ? /^Live/ : /^Standard queue/).check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
}
