import { expect, test } from "@playwright/test";
import { pageAs, seed } from "./helpers";

test.describe("per-client access", () => {
  test("member cannot open client B's market data and only sees A in the index", async ({ browser }) => {
    const { B } = seed();
    const page = await pageAs(browser, "member");

    const res = await page.goto(`/market-data/c/${B}`);
    const notFound = res?.status() === 404 || (await page.getByText(/Page not found/).isVisible());
    expect(notFound).toBe(true);
    await expect(page.getByRole("button", { name: /Get full data/ })).toHaveCount(0);
    expect((await page.goto(`/market-data/c/${B}/keyword?q=secret`))?.status() === 404 || (await page.getByText(/Page not found/).isVisible())).toBe(true);

    await page.goto("/market-data");
    await expect(page.getByLabel("Client").locator("option")).toHaveText(["Client Alpha"]);
    expect(await page.content()).not.toContain("Client Bravo");
    await page.context().close();
  });

  test("viewer on A sees cached lookup only, no paid buttons", async ({ browser }) => {
    const { A } = seed();
    const page = await pageAs(browser, "viewer");
    await page.goto(`/market-data/c/${A}/keyword?q=${encodeURIComponent("viewer check")}`);
    await expect(page.getByRole("button", { name: /Get full data/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Scan top 10/ })).toHaveCount(0);
    await expect(page.getByText(/read-only/).first()).toBeVisible();
    await page.context().close();
  });
});
