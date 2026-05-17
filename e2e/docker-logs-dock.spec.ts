import { test, expect } from "@playwright/test";

// Uses an existing local Docker connection in ~/.baklava/connections.json.
// If none exists, the test is skipped.
test.describe("docker — inline logs dock", () => {
  test.beforeEach(async ({ page }) => {
    // Find a docker connection via the public API.
    const res = await page.request.get("/api/connections?tech=docker");
    const body = await res.json();
    const dockerConn = body.connections?.[0];
    test.skip(
      !dockerConn,
      "no Docker connection saved — open the Docker tile + save one first",
    );
    test.info().annotations.push({ type: "id", description: dockerConn.id });
  });

  test("opens, shows logs region, ESC closes", async ({ page }) => {
    const res = await page.request.get("/api/connections?tech=docker");
    const dockerConn = (await res.json()).connections[0];
    await page.goto(`/docker/${dockerConn.id}/containers`);

    await expect(
      page.getByRole("heading", { name: "Containers" }),
    ).toBeVisible({ timeout: 10_000 });

    const viewLogs = page
      .getByRole("button", { name: /^view logs$/i })
      .first();
    await expect(viewLogs).toBeVisible({ timeout: 5_000 });
    await viewLogs.click();

    await expect(
      page.getByRole("region", { name: /Logs ·/ }),
    ).toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole("link", { name: /full view/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("region", { name: /Logs ·/ }),
    ).toBeHidden({ timeout: 3_000 });
  });

  test("collapse button shrinks the dock to a strip", async ({ page }) => {
    const res = await page.request.get("/api/connections?tech=docker");
    const dockerConn = (await res.json()).connections[0];
    await page.goto(`/docker/${dockerConn.id}/containers`);

    await page.getByRole("button", { name: /^view logs$/i }).first().click();

    const region = page.getByRole("region", { name: /Logs ·/ });
    await expect(region).toBeVisible();

    const fullHeight = await region.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(fullHeight).toBeGreaterThan(200);

    await page.getByRole("button", { name: /collapse logs panel/i }).click();
    await page.waitForTimeout(350); // height transition
    const collapsedHeight = await region.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(collapsedHeight).toBeLessThan(80);
  });

  test("close button (X) removes the dock", async ({ page }) => {
    const res = await page.request.get("/api/connections?tech=docker");
    const dockerConn = (await res.json()).connections[0];
    await page.goto(`/docker/${dockerConn.id}/containers`);

    await page.getByRole("button", { name: /^view logs$/i }).first().click();
    const region = page.getByRole("region", { name: /Logs ·/ });
    await expect(region).toBeVisible();

    // Scope the close click to the dock region — there's a generic "close"
    // button in the parent Sheet too.
    await region
      .getByRole("button", { name: /close logs panel/i })
      .click();
    await expect(region).toBeHidden();
  });
});
