import { expect, test } from "@playwright/test";
import { mockReset, pageAs, setTeamCap } from "./helpers";

test.describe("keyword research flow", () => {
  test("owner searches a keyword, gets full data, and sees DataForSEO values", async ({ browser }) => {
    await mockReset();
    const page = await pageAs(browser, "owner");
    await setTeamCap(page, "10", "live");

    await page.goto("/market-data");
    await page.getByLabel("Client").selectOption({ label: "Client Alpha" });
    await page.getByLabel("Keyword or domain").fill("seo tool");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/\/market-data\/c\/\d+\/keyword\?q=seo\+tool/);

    // Opening is free and cache-only: the paid button shows its price.
    const full = page.getByRole("button", { name: /Get full data · ≈\$/ });
    await expect(full).toBeVisible();
    await full.click();

    // Live mode answers in place; the standard queue would go to the pending page first.
    const tile = page.getByTestId("tile-search-volume");
    const pending = page.getByText("Results pending");
    await expect(tile.getByText("12,100").or(pending)).toBeVisible({ timeout: 30_000 });
    if (await pending.isVisible()) await expect(page.getByText(/Exact volumes are ready/)).toBeVisible({ timeout: 60_000 });
    else {
      await expect(tile).toContainText("DataForSEO");
      await expect(page.getByRole("link", { name: "View all" })).toBeVisible();
    }
    await page.context().close();
  });

  test("owner searches a domain and lands on the domain overview", async ({ browser }) => {
    const page = await pageAs(browser, "owner");
    await page.goto("/market-data");
    await page.getByLabel("Client").selectOption({ label: "Client Alpha" });
    await page.getByLabel("Keyword or domain").fill("https://www.example.com/some/page");
    await page.getByRole("button", { name: "Search" }).click();

    await page.waitForURL(/\/market-data\/c\/\d+\/domain\?d=example\.com/);
    await expect(page.getByRole("heading", { name: "example.com" })).toBeVisible();
    await expect(page.getByTestId("tile-organic-keywords")).toBeVisible();
    await expect(page.getByRole("button", { name: /Get domain data · ≈\$/ })).toBeVisible();
    await page.context().close();
  });
});
