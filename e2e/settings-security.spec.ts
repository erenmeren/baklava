import { test, expect } from "@playwright/test";

// Covers the session-management (#4) UI: the Settings security area renders the
// password-protection card, the active-sessions device list, and marks the
// current session as "this device". Runs under the authenticated storageState
// established by global-setup.
test.describe("settings security", () => {
  test("renders the security and active-sessions cards", async ({ page }) => {
    await page.goto("/settings");
    // Settings is tabbed (Provider / Permissions / Security); the security
    // cards live under the Security tab, which is not the default.
    await page.getByRole("tab", { name: "Security" }).click();
    await expect(page.getByText("Password protection")).toBeVisible();
    await expect(page.getByText("Active sessions")).toBeVisible();
    // The session global-setup logged in with is listed as the current device.
    await expect(page.getByText(/this device/i)).toBeVisible();
  });
});
