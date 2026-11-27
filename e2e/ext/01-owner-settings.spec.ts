import { expect, test } from "@playwright/test";
import { mockReset, pageAs, setTeamCap } from "./helpers";

test.describe("owner: DataForSEO settings", () => {
  test("saves credentials (password never echoed), sets the team cap, tests the connection", async ({ browser }) => {
    await mockReset();
    const page = await pageAs(browser, "owner");
    await page.goto("/settings/dataforseo");

    await expect(page.getByText("Not connected.")).toBeVisible();
    await page.getByLabel("API login").fill("e2e-login@example.invalid");
    await page.getByLabel("API password").fill("super-secret-api-password");
    await page.getByRole("button", { name: "Save credentials" }).click();
    await expect(page.getByText("Credentials saved (encrypted).")).toBeVisible();

    // After a reload the page knows it is connected, but the password
    // appears nowhere: not in a field, not in the markup.
    await page.reload();
    await expect(page.getByText(/Connected as/)).toBeVisible();
    await expect(page.getByLabel("API password")).toHaveValue("");
    expect(await page.content()).not.toContain("super-secret-api-password");

    await setTeamCap(page, "5");
    await page.reload();
    await expect(page.getByLabel("Team monthly cap (USD)")).toHaveValue("5");

    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText("Connected. Account balance: $42.50.")).toBeVisible();
    await page.context().close();
  });
});
