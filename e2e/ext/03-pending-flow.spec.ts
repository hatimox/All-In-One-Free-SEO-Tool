import { expect, test } from "@playwright/test";
import { mockCalls, mockReset, pageAs, paidCalls, seed, setTeamCap } from "./helpers";

test("standard lookup goes pending, becomes ready with a DataForSEO badge, and repeats from cache", async ({ browser }) => {
  const { A } = seed();
  await mockReset();
  const page = await pageAs(browser, "owner");
  await setTeamCap(page, "10", "standard");

  await page.goto(`/market-data/c/${A}`);
  await page.getByPlaceholder(/one keyword per line/).fill("seo tool");
  await page.getByRole("button", { name: /Get exact volumes/ }).click();

  await page.waitForURL(new RegExp(`/market-data/c/${A}/requests/\\d+`));
  await expect(page.getByText("Results pending")).toBeVisible();

  // The screen polls every 15s; the mock is ready on the second poll.
  await expect(page.getByText(/Exact volumes are ready/)).toBeVisible({ timeout: 60_000 });
  const row = page.getByRole("row", { name: /seo tool/ });
  await expect(row).toContainText("12,100");
  await expect(row).toContainText("DataForSEO");

  const posts = paidCalls(await mockCalls()).length;
  expect(posts).toBe(1);

  // Same keyword again: served from the shared cache, no new paid call.
  await page.goto(`/market-data/c/${A}`);
  await page.getByPlaceholder(/one keyword per line/).fill("seo tool");
  await page.getByRole("button", { name: /Get exact volumes/ }).click();
  const again = page.getByRole("row", { name: /seo tool/ });
  await expect(again).toContainText("12,100");
  await expect(again).toContainText("DataForSEO");
  expect(page.url()).not.toContain("/requests/");
  expect(paidCalls(await mockCalls())).toHaveLength(posts);
  await page.context().close();
});
