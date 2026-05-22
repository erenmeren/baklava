import { test, expect } from "@playwright/test";

test.describe("home page", () => {
  test("renders the tile grid with all signature tech entries", async ({
    page,
  }) => {
    await page.goto("/");
    // The home page is purely the tile grid — there's no hero heading.
    // Each tile uses <h3>{TechName}</h3>, so we verify by tile presence.
    // Only the enabled techs are rendered (others are hidden, not dimmed).
    for (const tech of ["Docker", "PostgreSQL", "Kafka", "SQL Server"]) {
      await expect(
        page.getByRole("heading", { level: 3, name: tech }),
      ).toBeVisible();
    }
  });

  test("clicking a tile opens the right-side connection sheet", async ({
    page,
  }) => {
    await page.goto("/");
    // Each tile is a <button aria-label="Open <Tech> connections"> that
    // opens the ConnectionSheet — NOT a Link.
    await page
      .getByRole("button", { name: /open postgresql connections/i })
      .click();
    // ConnectionSheet is a base-ui dialog. Wait for it to open.
    await expect(page.getByRole("dialog").first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
