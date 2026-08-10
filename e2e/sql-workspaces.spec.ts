import { test, expect, type Page } from "@playwright/test";
import { reachable } from "@/test/integration-helpers";

/**
 * SQL workspace smoke test: for each of the three SQL techs (Postgres, MySQL,
 * SQL Server), create a connection through the home-screen ConnectionSheet,
 * open its workspace, confirm the sidebar renders, open a seeded demo table,
 * click through every tab on the table-detail page, and confirm none of them
 * shows a rendered error state.
 *
 * The postgres and sqlserver blocks have run green against real services
 * (docker containers `baklava-postgres` / `baklava-sqlserver`, seeded per
 * `seed/postgres.sh` / `seed/sqlserver.sh`) in both chromium-light and
 * chromium-dark, including `clickThroughTabs` on a seeded demo table.
 *
 * The mysql block was un-fixme'd in Phase 2 Task 14, once `compose.yaml`
 * gained a mysql service and `seed/mysql.sh` gave it a named `demo` database
 * with a `customers` table — so its selectors are named the same way the
 * other two blocks' are, rather than "first button in the sidebar". It has
 * not yet had a green run against a live server; the reachability gate below
 * is what keeps that honest on a machine without the stack up.
 *
 * Each block is gated on a plain TCP reachability probe of the service's
 * compose port — mirroring the `reachable()` gate that
 * src/lib/connections/services.integration.test.ts uses for the vitest
 * integration suite — and prints a visible `console.warn` when it skips, so
 * a run against a machine without the stack up is loud about having tested
 * nothing rather than quietly reporting green.
 *
 * Demo data: run `docker compose up -d postgres mysql sqlserver` then
 * `bash seed/all.sh` first — the table names below (`shop.customers`,
 * `shop.Customers`, `demo.customers`) come from those seed scripts.
 */

const PW = "Baklava123!";
const POSTGRES_PORT = 5432;
const SQLSERVER_PORT = 1433;
const MYSQL_PORT = 3306;

/** Open the home-screen ConnectionSheet for `tech` and fill+save a new connection. */
async function createConnection(
  page: Page,
  opts: {
    tileName: RegExp;
    passwordFieldId: string;
    /** Extra fields to fill before saving (e.g. the demo database name). */
    fill?: Record<string, string>;
  },
) {
  await page.goto("/");
  await page.getByRole("button", { name: opts.tileName }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await dialog.getByRole("button", { name: /new connection/i }).click();
  for (const [id, value] of Object.entries(opts.fill ?? {})) {
    await dialog.locator(`#${id}`).fill(value);
  }
  await dialog.locator(`#${opts.passwordFieldId}`).fill(PW);
  await dialog.getByRole("button", { name: /test & save/i }).click();

  // A successful save returns the sheet to the list view — the "New
  // connection" button reappears there. This also acts as the wait for the
  // probe/save round-trip to finish.
  await expect(
    dialog.getByRole("button", { name: /new connection/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Open the connection we just saved — it's the newest row.
  await dialog.getByRole("button", { name: /^open$/i }).first().click();
}

/**
 * Click through every `role=tab` on the currently-open table-detail page,
 * wait for each panel to actually finish loading, and assert none of them
 * renders a visible destructive/error banner.
 *
 * Two things have to both be true for this to mean anything:
 *  - There has to be a positive signal that the panel rendered before any
 *    negative assertion runs, otherwise `toHaveCount(0)` trivially resolves
 *    against an empty/still-loading DOM on its first poll and proves
 *    nothing. Every tab shows a `<Skeleton data-slot="skeleton">` while its
 *    data is in flight (see table-detail-client.tsx), so waiting for those
 *    to clear from the active tabpanel is that signal.
 *  - The selector asserted against has to be one the app actually emits.
 *    `Alert` (src/components/ui/alert.tsx) renders `role="alert"` but never
 *    a `data-variant` attribute — that was class-only and the DOM never
 *    carried it — so match on the `text-destructive` class token the
 *    `destructive` variant adds instead. `toast.error(...)` calls across
 *    the three table-detail clients ("Could not load…", "…failed") are the
 *    other real error surface reachable from a background fetch failure
 *    while browsing.
 */
async function clickThroughTabs(page: Page) {
  // Scope to the table-detail page's own tablist (Data / Structure / …),
  // not the workspace-level "Open tables and editors" / "Open objects and
  // editors" tab strip (postgres-tabs.tsx / sqlserver-tabs.tsx) that also
  // renders role="tab" elements further up the page (Overview, the
  // shop.customers tab itself). An unscoped getByRole("tab") sweeps those in
  // too — clicking "Overview" mid-loop navigates clean off the table-detail
  // page it's meant to be exercising. The detail tablist has no accessible
  // name; disambiguate by requiring the "Data" tab this function is always
  // called right after asserting is visible (see call sites below).
  const tablist = page
    .getByRole("tablist")
    .filter({ has: page.getByRole("tab", { name: "Data", exact: true }) });
  const tabs = tablist.getByRole("tab");
  const count = await tabs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();

    // Positive signal: the active panel's loading skeletons are gone. This
    // only means something if a panel actually exists — assert that first,
    // so a future zero-panel regression can't make the negative assertions
    // below pass vacuously against an empty DOM.
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveCount(1);
    await expect(panel.locator('[data-slot="skeleton"]')).toHaveCount(0, {
      timeout: 10_000,
    });

    await expect(page.locator('[role="alert"].text-destructive')).toHaveCount(0);
    await expect(page.getByText(/could not load|failed/i)).toHaveCount(0);
  }
}

test.describe("postgres SQL workspace", () => {
  let up = false;
  test.beforeAll(async () => {
    up = await reachable("localhost", POSTGRES_PORT);
    if (!up) {
      console.warn(
        `[skip] postgres SQL workspace e2e — postgres not reachable on localhost:${POSTGRES_PORT}. ` +
          "Run `docker compose up -d postgres && bash seed/postgres.sh` first.",
      );
    }
  });

  test("sidebar renders, a seeded table opens, and every tab is error-free", async ({
    page,
  }) => {
    test.skip(!up, `postgres not reachable on localhost:${POSTGRES_PORT}`);

    await createConnection(page, {
      tileName: /open postgresql connections/i,
      passwordFieldId: "pg-pass",
    });

    // Workspace chrome loaded — the sidebar's "Databases" tree root renders.
    // Scoped to the sidebar landmark: the page heading also reads "Databases"
    // (h2 in the overview grid), so an unscoped getByText matches both and
    // trips Playwright's strict-mode violation.
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.getByText("Databases", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Expand demo → shop (seed/postgres.sh). No explicit "Tables" click:
    // toggleSchema (postgres-sidebar.tsx:313-323) unconditionally auto-opens
    // the Tables group as a side effect of expanding the schema
    // (`setOpenGroup((s) => ({ ...s, [tk]: true }))`), and Group only renders
    // its <ul> (and therefore the table links) while open
    // (postgres-sidebar.tsx:1420-1434). Clicking "Tables" here would toggle
    // that already-open group closed and make the link below unreachable.
    // Scoped to the sidebar and exact-matched: the "Slowest queries" panel
    // on the overview page renders raw SQL text as link content, and once a
    // query touching shop.customers has run, a substring match on
    // "customers" resolves there too (strict-mode violation) alongside the
    // sidebar's table link.
    await sidebar.getByRole("button", { name: /^demo$/ }).click();
    await sidebar.getByRole("button", { name: /^shop$/ }).click();
    await sidebar.getByRole("link", { name: "customers", exact: true }).click();

    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 10_000,
    });
    await clickThroughTabs(page);
  });
});

test.describe("sqlserver SQL workspace", () => {
  let up = false;
  test.beforeAll(async () => {
    up = await reachable("localhost", SQLSERVER_PORT);
    if (!up) {
      console.warn(
        `[skip] sqlserver SQL workspace e2e — sqlserver not reachable on localhost:${SQLSERVER_PORT}. ` +
          "Run `docker compose up -d sqlserver && bash seed/sqlserver.sh` first.",
      );
    }
  });

  test("sidebar renders, a seeded table opens, and every tab is error-free", async ({
    page,
  }) => {
    test.skip(!up, `sqlserver not reachable on localhost:${SQLSERVER_PORT}`);

    await createConnection(page, {
      tileName: /open sql server connections/i,
      passwordFieldId: "mssql-password",
    });

    // Scoped to the sidebar landmark for the same reason as the Postgres
    // block above: the page heading also reads "Databases" (h3 here).
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.getByText("Databases", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Expand BaklavaDemo → shop (seed/sqlserver.sh). No explicit "Tables"
    // click — same auto-open-on-schema-expand behaviour as Postgres:
    // toggleSchema (sqlserver-sidebar.tsx:319-327) unconditionally sets
    // `openGroup[\`${key}.tables\`] = true` when the schema opens, and
    // Group only renders the table links while open. Clicking "Tables"
    // here would collapse that already-open group.
    // Scoped to the sidebar and exact-matched: confirmed live that the
    // overview page's "Top queries · plan cache" panel renders raw SQL text
    // as link content, and once a query touching shop.Customers has run, an
    // unscoped substring match on "Customers" resolves there too (strict-mode
    // violation: "SELECT c.name AS name, …") alongside the sidebar's table
    // link.
    await sidebar.getByRole("button", { name: /^BaklavaDemo$/ }).click();
    await sidebar.getByRole("button", { name: /^shop$/ }).click();
    await sidebar.getByRole("link", { name: "Customers", exact: true }).click();

    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 10_000,
    });
    await clickThroughTabs(page);
  });
});

test.describe("mysql SQL workspace", () => {
  let up = false;
  test.beforeAll(async () => {
    up = await reachable("localhost", MYSQL_PORT);
    if (!up) {
      console.warn(
        `[skip] mysql SQL workspace e2e — mysql not reachable on localhost:${MYSQL_PORT}. ` +
          "Run `docker compose up -d mysql && bash seed/mysql.sh` first.",
      );
    }
  });

  test("sidebar renders, a seeded table opens, and every tab is error-free", async ({
    page,
  }) => {
    test.skip(!up, `mysql not reachable on localhost:${MYSQL_PORT}`);

    await createConnection(page, {
      tileName: /open mysql connections/i,
      passwordFieldId: "my-pass",
      fill: { "my-db": "demo" },
    });

    const sidebar = page.getByRole("complementary");
    await expect(sidebar.getByText("Databases", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // MySQL's sidebar has no schema level and no "Tables" group — `renderDb`
    // (mysql-sidebar.tsx:176-235) lists a database's tables directly as
    // <TableRow> children the moment the database row is expanded. So this is
    // genuinely two clicks, not three, and there's no
    // auto-open-then-re-collapse hazard like the other two blocks have.
    // Exact-matched and sidebar-scoped for the same strict-mode reason as
    // above.
    await sidebar.getByRole("button", { name: /^demo$/ }).click();
    await sidebar.getByRole("link", { name: "customers", exact: true }).click();

    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 10_000,
    });
    await clickThroughTabs(page);
  });
});
