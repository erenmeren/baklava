import { test, expect } from "@playwright/test";

// Baklava ships one theme (neon glass, dark). A stale `baklava-theme=light`
// cookie from an older build must not bring light mode back.
test("always dark, even with a leftover light-theme cookie", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "baklava-theme", value: "light", url: baseURL! }]);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 3, name: "Docker" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.className)).toContain("dark");
  await expect(page.getByRole("button", { name: /switch to (light|dark) theme/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});
