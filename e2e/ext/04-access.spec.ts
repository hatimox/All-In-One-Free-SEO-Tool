import { expect, test } from "@playwright/test";
import { pageAs, seed } from "./helpers";

test.describe("per-client access", () => {
  test("member cannot open client B's market data and only sees A in the index", async ({ browser }) => {
    const { A, B } = seed();
    const page = await pageAs(browser, "member");

    const res = await page.goto(`/market-data/c/${B}`);
    const notFound = res?.status() === 404 || (await page.getByText(/Page not found/).isVisible());
    expect(notFound).toBe(true);
    await expect(page.getByRole("button", { name: /Get exact volumes/ })).toHaveCount(0);

    await page.goto("/market-data");
    await expect(page.getByText("Client Alpha")).toBeVisible();
    await expect(page.getByText("Client Bravo")).toHaveCount(0);
    await expect(page.locator(`a[href="/market-data/c/${A}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/market-data/c/${B}"]`)).toHaveCount(0);
    await page.context().close();
  });

  test("viewer on A sees cached lookup only, no paid buttons", async ({ browser }) => {
    const { A } = seed();
    const page = await pageAs(browser, "viewer");
    await page.goto(`/market-data/c/${A}`);
    await expect(page.getByRole("button", { name: /Look up \(cached, free\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Get exact volumes/ })).toHaveCount(0);
    await expect(page.getByText(/read-only/)).toBeVisible();
    await page.context().close();
  });
});
