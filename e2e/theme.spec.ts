import { test, expect } from "@playwright/test";

const BASE =
  process.env.E2E_BASE_URL ??
  (process.env.CI ? "http://localhost:3100" : "http://localhost:3000");

test.describe("theme cookie", () => {
  test("light theme: body background is light, no runtime errors", async ({
    page,
  }) => {
    await page.context().addCookies([
      { name: "baklava-theme", value: "light", url: BASE },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    // The home tile grid is the proof that the page mounted.
    await expect(
      page.getByRole("heading", { level: 3, name: "Docker" }),
    ).toBeVisible();

    // In light mode the html element does NOT carry the .dark class.
    const htmlClass = await page.evaluate(() =>
      document.documentElement.className,
    );
    expect(htmlClass).not.toContain("dark");

    expect(errors).toEqual([]);
  });

  test("dark theme: html.dark is applied, no runtime errors", async ({
    page,
  }) => {
    await page.context().addCookies([
      { name: "baklava-theme", value: "dark", url: BASE },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 3, name: "Docker" }),
    ).toBeVisible();

    const htmlClass = await page.evaluate(() =>
      document.documentElement.className,
    );
    expect(htmlClass).toContain("dark");

    expect(errors).toEqual([]);
  });
});
