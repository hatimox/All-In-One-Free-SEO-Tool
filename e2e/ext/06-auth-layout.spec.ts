import { expect, test } from "@playwright/test";
import { AUTH_DIR } from "./env.mjs";

// Signed-out pages render in the bare auth shell: brand on top, the form,
// and none of the app chrome (sidebar links, top bar, AI banner).
test.describe("auth layout", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login page has no app sidebar", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /collapse sidebar/i })).toHaveCount(0);
  });

  test("a client-sent x-auth-page header does not strip chrome from app pages", async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: `${AUTH_DIR}/owner.json`,
      extraHTTPHeaders: { "x-auth-page": "1" },
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();
    await ctx.close();
  });
});
