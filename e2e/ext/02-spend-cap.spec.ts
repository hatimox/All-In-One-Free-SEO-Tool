import { expect, test } from "@playwright/test";
import { mockCalls, mockReset, pageAs, paidCalls, seed, setTeamCap } from "./helpers";

test("a tiny team cap blocks paid lookups before anything reaches DataForSEO", async ({ browser }) => {
  const { A } = seed();
  await mockReset();
  const page = await pageAs(browser, "owner");
  await setTeamCap(page, "0.01");

  await page.goto(`/market-data/c/${A}/keyword?q=${encodeURIComponent("cap test keyword")}`);
  await page.getByRole("button", { name: /Get full data/ }).click();

  await expect(page.getByRole("alert")).toContainText(/Team DataForSEO budget reached/);
  expect(paidCalls(await mockCalls())).toHaveLength(0);
  await page.context().close();
});
