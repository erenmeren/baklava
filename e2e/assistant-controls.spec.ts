import { test, expect } from "@playwright/test";

// Covers the AI emergency-controls (#5) UI: the assistant header renders the
// kill-switch ("Pause AI") control. The toggle's behavior + persistence is
// unit-tested (kill-switch.test.ts / kill-switch-route.test.ts); here we only
// smoke that the control is present and the page renders, because the kill
// switch is global server state and the light/dark projects share one server
// (a stateful toggle here would race across projects).
test.describe("assistant controls", () => {
  test("header shows the AI kill-switch control", async ({ page }) => {
    await page.goto("/assistant");
    await expect(page.getByRole("button", { name: /pause ai/i })).toBeVisible();
  });
});
