import { expect, test } from "@playwright/test";
import { pageAs, seed } from "./helpers";

// There is no UI path from a member to client B's rows: every per-client
// route sits behind the scope layout. Assert that, and that B's data does
// not leak into the member's global lists.
test("member cannot reach client B's keywords or backlinks to untrack or delete them", async ({ browser }) => {
  const { B } = seed();
  const page = await pageAs(browser, "member");

  for (const path of [`/keywords/c/${B}`, `/backlinks/c/${B}`, `/clients/${B}`]) {
    const res = await page.goto(path);
    const notFound = res?.status() === 404 || (await page.getByText(/Page not found/).isVisible());
    expect(notFound, path).toBe(true);
  }

  await page.goto("/keywords");
  await expect(page.getByText("bravo secret keyword")).toHaveCount(0);
  await page.goto("/backlinks");
  await expect(page.getByText("linker.example.invalid")).toHaveCount(0);
  await page.context().close();
});
