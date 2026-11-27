import { expect, test } from "@playwright/test";
import { mockCalls, mockReset, pageAs, paidCalls, seed, setTeamCap } from "./helpers";

test("standard lookup goes pending, becomes ready with a DataForSEO badge, and repeats from cache", async ({ browser }) => {
  const { A } = seed();
  await mockReset();
  const page = await pageAs(browser, "owner");
  await setTeamCap(page, "10", "standard");

  await page.goto(`/market-data/c/${A}/keyword?q=${encodeURIComponent("seo tool")}`);
  await page.getByRole("button", { name: /Get full data/ }).click();

  await page.waitForURL(new RegExp(`/market-data/c/${A}/requests/\\d+`));
  await expect(page.getByText("Results pending")).toBeVisible();

  // The screen polls every 15s; the mock is ready on the second poll.
  await expect(page.getByText(/Exact volumes are ready/)).toBeVisible({ timeout: 60_000 });
  const row = page.getByRole("row", { name: /seo tool/ });
  await expect(row).toContainText("12,100");
  await expect(row).toContainText("DataForSEO");

  // Volume tasks only: the overview also runs (empty) Labs lookups for difficulty, intent and ideas.
  const volumePosts = async () => paidCalls(await mockCalls()).filter((c) => c.path.includes("/keywords_data/")).length;
  const posts = await volumePosts();
  expect(posts).toBe(1);

  // Same keyword again: served from the shared cache, no new paid call.
  // The overview opens from the cache: the volume is there with no click and no new task.
  await page.goto(`/market-data/c/${A}/keyword?q=${encodeURIComponent("seo tool")}`);
  const tile = page.getByTestId("tile-search-volume");
  await expect(tile).toContainText("12,100");
  await expect(tile).toContainText("DataForSEO");
  expect(page.url()).not.toContain("/requests/");
  expect(await volumePosts()).toBe(posts);
  await page.context().close();
});
