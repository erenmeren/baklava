import { test, expect } from "@playwright/test";

// Covers the end-to-end auth lifecycle: a protected route bounces an
// unauthenticated visitor to /login, a member can sign in, the "Lock console"
// control logs them out, and the now-dead session can no longer reach a
// protected route.
//
// SAFETY: the light + dark chromium projects share ONE dev server, and EVERY
// spec (plus the sibling project) reuses the single admin session persisted to
// storageState by global-setup. Logging that session out would cascade-fail the
// whole suite. So everything here that touches a session runs inside a FRESH
// context (browser.newContext({ storageState: undefined })) on a DEDICATED
// per-project member user — the shared admin storageState is never logged out or
// revoked. The member-creation step (run as admin) is GLOBAL server state shared
// by both projects, so it is made idempotent to tolerate the concurrent run /
// retries.
test.describe("auth flow", () => {
  test("login → logout → protected-route redirect", async ({ page, browser }) => {
    // Unique, valid (a-z0-9._-) username per project so the two concurrent
    // projects don't collide on the same global user.
    const uname = `member_${test.info().project.name}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
    const memberPassword = "member-pass-123";

    // 1. As the admin (default storageState context), create the member through
    //    the Settings → Users tab UI. Idempotent: skip the form if the row is
    //    already present from a concurrent project / a retry.
    await page.goto("/settings");
    const usersTab = page.getByRole("tab", { name: "Users" });
    await expect(usersTab).toBeVisible();
    await usersTab.click();
    await expect(
      page.getByText("People who can sign in to this console"),
    ).toBeVisible();

    const existingRow = page.getByRole("listitem").filter({ hasText: uname });
    if ((await existingRow.count()) === 0) {
      await page.getByPlaceholder("username").fill(uname);
      await page.getByPlaceholder("password").fill(memberPassword);
      // Role defaults to "member" — leave the Select untouched.
      await page.getByRole("button", { name: "Add user" }).click();
    }
    // Require only that the member row exists (tolerate a 409 from the
    // concurrent/retry create).
    await expect(
      page.getByRole("listitem").filter({ hasText: uname }),
    ).toBeVisible({ timeout: 10_000 });

    // 2. FRESH context, NO storageState — fully isolated from the shared admin
    //    session. This is the only place we drive login/logout.
    const ctx = await browser.newContext({ storageState: undefined });
    try {
      const fresh = await ctx.newPage();

      // 2a. A protected route, unauthenticated, redirects to /login.
      await fresh.goto("/settings");
      await expect(fresh).toHaveURL(/\/login(\?|$)/, { timeout: 10_000 });
      await expect(
        fresh.getByRole("button", { name: "Sign in" }),
      ).toBeVisible();

      // 2b. Sign in as the member. With >1 user, multiUser === true so the
      //     username field is shown.
      const usernameField = fresh.getByLabel("Username");
      await expect(usernameField).toBeVisible();
      await usernameField.fill(uname);
      await fresh.getByLabel("Password", { exact: true }).fill(memberPassword);
      await fresh.getByRole("button", { name: "Sign in" }).click();

      // 2c. Landed on an authenticated page (home), not bounced to /login, and
      //     the login card is gone.
      await expect(fresh).toHaveURL(/\/$|\/\?/, { timeout: 10_000 });
      await expect(
        fresh.getByRole("button", { name: "Sign in" }),
      ).toHaveCount(0);
      // The "Lock console" control only renders for an authed session — its
      // presence is positive proof we're signed in.
      const lockButton = fresh.getByRole("button", { name: "Lock console" });
      await expect(lockButton).toBeVisible();

      // 2d. Log out via the "Lock console" control → back to /login.
      await lockButton.click();
      await expect(fresh).toHaveURL(/\/login(\?|$)/, { timeout: 10_000 });
      await expect(
        fresh.getByRole("button", { name: "Sign in" }),
      ).toBeVisible();

      // 2e. The session is gone: a protected route again redirects to /login.
      await fresh.goto("/settings");
      await expect(fresh).toHaveURL(/\/login(\?|$)/, { timeout: 10_000 });
    } finally {
      await ctx.close();
    }
  });
});
