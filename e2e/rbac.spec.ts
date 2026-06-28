import { test, expect } from "@playwright/test";

// Covers the multi-user RBAC flow (#12): an admin (the migrated `admin` user the
// authenticated storageState belongs to) creates a member user through the
// Settings → Users tab, then that member signs in and is denied the admin-only
// Users tab.
//
// IMPORTANT: the light + dark chromium projects share ONE dev server and run
// this spec concurrently. Any user created here is GLOBAL server state, so the
// username is derived per-project to avoid 409 collisions, and creation is made
// idempotent (a retry that re-runs against an already-created user is tolerated).
test.describe("rbac multi-user", () => {
  test("admin creates a member; member is denied the Users tab", async ({
    page,
    browser,
  }) => {
    // Unique, valid (a-z0-9._-) username per project so the two concurrent
    // projects don't collide on the same global user.
    const uname = `member_${test.info().project.name}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
    const memberPassword = "member-pass-123";

    // 1. Admin sees the Users tab in Settings.
    await page.goto("/settings");
    const usersTab = page.getByRole("tab", { name: "Users" });
    await expect(usersTab).toBeVisible();
    await usersTab.click();

    // The Users card description confirms the tab panel rendered. The card
    // title isn't a heading element, so anchor on this unambiguous copy.
    await expect(
      page.getByText("People who can sign in to this console"),
    ).toBeVisible();

    // 2. Create a member user through the "Add user" form, unless a previous
    //    (retried) run already created it. The list is keyed by username text.
    const existingRow = page.getByRole("listitem").filter({ hasText: uname });
    if ((await existingRow.count()) === 0) {
      await page.getByPlaceholder("username").fill(uname);
      await page.getByPlaceholder("password").fill(memberPassword);
      // Role defaults to "member" in the Add-user form, so no Select change is
      // needed — leaving it untouched keeps the test resilient to base-ui's
      // Select internals.
      await page.getByRole("button", { name: "Add user" }).click();
    }

    // The member appears in the list with a "member" badge. Tolerate the 409
    // from a concurrent/retry create — we only require the row to exist.
    const memberRow = page.getByRole("listitem").filter({ hasText: uname });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });
    // "member" appears both as the role badge and inside the role Select trigger;
    // target the badge element specifically (data-slot="badge").
    await expect(
      memberRow.locator('[data-slot="badge"]', { hasText: "member" }),
    ).toBeVisible();

    // 3. New context (no storageState) — sign in as the member. With >1 user the
    //    login form now shows the username field (multiUser === true).
    const memberCtx = await browser.newContext({ storageState: undefined });
    try {
      const memberPage = await memberCtx.newPage();
      await memberPage.goto("/login");

      const usernameField = memberPage.getByLabel("Username");
      await expect(usernameField).toBeVisible();
      await usernameField.fill(uname);
      await memberPage.getByLabel("Password", { exact: true }).fill(memberPassword);
      await memberPage.getByRole("button", { name: "Sign in" }).click();

      // Landed on the app (home grid), not bounced back to /login.
      await expect(memberPage).toHaveURL(/\/$|\/\?/, { timeout: 10_000 });

      // 4. As the member, the Settings page must NOT expose the Users tab.
      await memberPage.goto("/settings");
      await expect(
        memberPage.getByRole("tab", { name: "Provider & keys" }),
      ).toBeVisible();
      await expect(
        memberPage.getByRole("tab", { name: "Users" }),
      ).toHaveCount(0);

      // 5. The member starts with no connection access. The admin's
      //    storageState session never seeded any connections, so we assert the
      //    member's home shows no connection workspaces leaked from the admin —
      //    but since this run seeds none, there's nothing connection-specific to
      //    assert without fixtures; the Users-tab denial above is the load-bearing
      //    RBAC check. (Skipping a connection-access assertion to avoid seeding.)
    } finally {
      await memberCtx.close();
    }
  });
});
