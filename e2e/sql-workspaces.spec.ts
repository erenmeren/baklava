import { test, expect, type Page } from "@playwright/test";
import { reachable } from "@/test/integration-helpers";

/**
 * SQL workspace smoke test: for each of the three SQL techs (Postgres, MySQL,
 * SQL Server), create a connection through the home-screen ConnectionSheet,
 * open its workspace, confirm the sidebar renders, open a seeded demo table,
 * click through every tab on the table-detail page, and confirm none of them
 * shows a rendered error state.
 *
 * The Docker daemon is unreachable in this development environment (no
 * compose plugin, port 5432 closed) — established and independently
 * confirmed. These blocks therefore could not be run against real services
 * here; this file has only been verified to typecheck, lint, and be
 * collectable by `npx playwright test e2e/sql-workspaces.spec.ts --list`.
 *
 * Each block is gated on a plain TCP reachability probe of the service's
 * compose port — mirroring the `reachable()` gate that
 * src/lib/connections/services.integration.test.ts uses for the vitest
 * integration suite — and prints a visible `console.warn` when it skips, so
 * a run against a machine without the stack up is loud about having tested
 * nothing rather than quietly reporting green.
 *
 * Demo data: run `docker compose up -d postgres sqlserver` then
 * `bash seed/postgres.sh` / `bash seed/sqlserver.sh` (or `bash seed/all.sh`)
 * first — the table names below (`shop.customers` / `shop.Customers`) come
 * from those seed scripts, which create a `shop` schema with `customers`,
 * `products`, `orders`, and `order_items` tables.
 *
 * MySQL has no service in compose.yaml at all (only postgres, sqlserver,
 * kafka — see that file's own header comment), so the mysql block below
 * always skips today, on every machine, until a later phase adds one. When
 * it does, this block only needs MYSQL_PORT flipped to reachable — the rest
 * of the flow (connection form, sidebar, table tabs) is already wired the
 * same way as the other two.
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
  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();

    // Positive signal: the active panel's loading skeletons are gone.
    const panel = page.getByRole("tabpanel");
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
    await expect(page.getByText("Databases", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Expand demo → shop (seed/postgres.sh). No explicit "Tables" click:
    // toggleSchema (postgres-sidebar.tsx:313-323) unconditionally auto-opens
    // the Tables group as a side effect of expanding the schema
    // (`setOpenGroup((s) => ({ ...s, [tk]: true }))`), and Group only renders
    // its <ul> (and therefore the table links) while open
    // (postgres-sidebar.tsx:1420-1434). Clicking "Tables" here would toggle
    // that already-open group closed and make the link below unreachable.
    await page.getByRole("button", { name: /^demo$/ }).click();
    await page.getByRole("button", { name: /^shop$/ }).click();
    await page.getByRole("link", { name: "customers" }).click();

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

    await expect(page.getByText("Databases", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Expand BaklavaDemo → shop (seed/sqlserver.sh). No explicit "Tables"
    // click — same auto-open-on-schema-expand behaviour as Postgres:
    // toggleSchema (sqlserver-sidebar.tsx:319-327) unconditionally sets
    // `openGroup[\`${key}.tables\`] = true` when the schema opens, and
    // Group only renders the table links while open. Clicking "Tables"
    // here would collapse that already-open group.
    await page.getByRole("button", { name: /^BaklavaDemo$/ }).click();
    await page.getByRole("button", { name: /^shop$/ }).click();
    await page.getByRole("link", { name: "Customers" }).click();

    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 10_000,
    });
    await clickThroughTabs(page);
  });
});

test.describe("mysql SQL workspace", () => {
  // MySQL has no service in compose.yaml at all (only postgres, sqlserver,
  // kafka), so `up` is always false today — this block always skips, on
  // every machine, until a later phase adds a compose service for it. It's
  // still written and wired here (rather than omitted) so that phase only
  // has to add the service and flip MYSQL_PORT to reachable, not author a
  // new spec.
  let up = false;
  test.beforeAll(async () => {
    up = await reachable("localhost", MYSQL_PORT);
    if (!up) {
      console.warn(
        `[skip] mysql SQL workspace e2e — mysql not reachable on localhost:${MYSQL_PORT}. ` +
          "There is no mysql service in compose.yaml yet (Phase 2) — this block always skips today.",
      );
    }
  });

  test("sidebar renders, a table opens, and every tab is error-free", async ({
    page,
  }) => {
    test.skip(!up, `mysql not reachable on localhost:${MYSQL_PORT}`);

    // Unverified against a live service: there's no MySQL seed script or
    // compose entry yet, so the generic "click the first button/link"
    // selectors below have never actually run and cannot be trusted —
    // without scoping, "first button on the page" is just as likely to be
    // app chrome (theme toggle, tab strip, sidebar header) as a database
    // row. Keep as fixme (not a silent skip) until Phase 2 adds a seed
    // script, this block runs for real, and the selectors get named like
    // the Postgres/SQL Server blocks above.
    test.fixme(true, "needs a MySQL seed script + a real run before these selectors can be trusted");

    await createConnection(page, {
      tileName: /open mysql connections/i,
      passwordFieldId: "my-pass",
    });

    await expect(page.getByText("Databases", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Unlike Postgres/SQL Server, MySQL's sidebar has no schema/"Tables"-group
    // level at all — `renderDb` in mysql-sidebar.tsx lists a database's
    // tables directly as <TableRow> children the moment the database row
    // itself is expanded (no toggleSchema/toggleGroup step, so there's no
    // auto-open-then-re-collapse hazard here the way there is in the other
    // two blocks). There is also no seed script or demo database for MySQL
    // yet (no compose service — this block always skips today), so there's
    // no known database/table name to target the way the Postgres/SQL
    // Server blocks above do by exact name; expand the first database row
    // generically instead. Revisit once Phase 2 adds a MySQL seed script:
    // name the specific database/table like the other two blocks do.
    //
    // Scoped to the sidebar landmark (WorkspaceShell renders it as an
    // `<aside>`, which Playwright exposes via the "complementary" role) so
    // this doesn't fall back to clicking the first button/link on the
    // *page* — that would just as likely be app chrome (theme toggle, tab
    // strip, sidebar header) as a database row.
    const sidebar = page.getByRole("complementary");
    await sidebar.getByRole("button").filter({ hasText: /.+/ }).first().click();
    await sidebar.getByRole("link", { name: /.+/ }).first().click();

    await expect(page.getByRole("tab", { name: "Data" })).toBeVisible({
      timeout: 10_000,
    });
    await clickThroughTabs(page);
  });
});
