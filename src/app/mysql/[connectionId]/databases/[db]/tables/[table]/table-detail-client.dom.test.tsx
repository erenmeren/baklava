import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { mockFetch, httpError, netFail } from "@/test/fetch-mock";
import { TableDetailClient } from "./table-detail-client";

// TableDetailClient reads `useRouter` from next/navigation (only `router.push`
// is ever called, on a successful Drop). There is no App Router mounted in
// these tests, so the real hook throws ("invariant expected app router to be
// mounted"). Stub the module instead of adding a router-testing dependency.
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

// The component renders `<Button render={<a href=… />} nativeButton={false}>`
// for its "Open query" action, so base-ui logs nothing. Any console.error at
// all is a failure — vitest only prints captured console output for failing
// tests, so a plain "did anything log?" check would miss a regression here.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    throw new Error(`Unexpected console.error: ${String(args[0])}`);
  });
});
afterEach(() => consoleErrorSpy.mockRestore());

// Shape matches ColumnInfo returned by listColumns in
// src/lib/connections/mysql.ts — not the brief's guess (which invented
// `defaultValue` and omitted `columnType`/`extra`/`comment`/`ordinal`, all of
// which the Structure tab and row-form dialog read).
const COLUMNS = [
  {
    name: "id",
    dataType: "int",
    columnType: "int",
    nullable: false,
    default: null,
    isPrimaryKey: true,
    extra: "auto_increment",
    comment: "",
    ordinal: 1,
  },
  {
    name: "email",
    dataType: "varchar",
    columnType: "varchar(255)",
    nullable: false,
    default: null,
    isPrimaryKey: false,
    extra: "",
    comment: "",
    ordinal: 2,
  },
];

// Shape matches IndexInfo from listIndexes — `primary`/`type`, not the
// brief's `unique`-only guess.
const INDEXES = [
  { name: "PRIMARY", unique: true, primary: true, type: "BTREE", columns: ["id"] },
];

// Shape matches the GET /api/mysql/[id]/databases/[db]/tables/[table] route,
// which spreads listColumns + listIndexes + getTableDDL and adds a derived
// `primaryKey` array. TableDetailClient reads `meta.primaryKey` to decide
// whether row edit/delete are enabled — the brief's fixture omitted it.
const META = {
  columns: COLUMNS,
  indexes: INDEXES,
  ddl: "CREATE TABLE `users` (…);",
  primaryKey: ["id"],
};

// Shape matches TableData from src/lib/connections/mysql.ts (readTableData)
// — the field is `totalRows`, not `total` as the brief guessed, and it also
// carries `primaryKey`.
const ROWS = {
  columns: ["id", "email"],
  rows: [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ],
  totalRows: 2,
  primaryKey: ["id"],
};

// The constraints endpoint Task 13 added — its own request, feeding both the
// Constraints and the Foreign keys tab.
const CONSTRAINTS = {
  constraints: [
    { name: "PRIMARY", type: "PRIMARY KEY", definition: "" },
    { name: "users_email_ck", type: "CHECK", definition: "(`email` like '%@%')" },
  ],
  foreignKeys: [
    {
      name: "fk_users_org",
      columns: ["org_id"],
      refSchema: "appdb",
      refTable: "orgs",
      refColumns: ["id"],
      onUpdate: "NO ACTION",
      onDelete: "CASCADE",
    },
  ],
};

let restore: () => void;

function calls(): string[] {
  return (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  restore = mockFetch({
    "/rows": ROWS,
    // "$"-anchored: the rows request's URL is this same path plus "/rows",
    // so an unanchored "/tables/users" would also match it — see
    // src/test/fetch-mock.ts's doc comment.
    "/tables/users$": META,
    "/constraints": CONSTRAINTS,
  });
});

afterEach(() => restore());

function renderIt() {
  return render(<TableDetailClient connectionId="c1" db="appdb" table="users" />);
}

describe("mysql TableDetailClient (characterization)", () => {
  it("renders all six tabs", async () => {
    renderIt();
    for (const label of [
      "Data",
      "Structure",
      "Indexes",
      "Constraints",
      "Foreign keys",
      "DDL",
    ]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  // Statistics stays Postgres-only — MySQL has no pg_stat_user_tables
  // equivalent this workspace reads. Paired with the positive assertion above
  // so this can't pass vacuously off a component that failed to render.
  it("has no Statistics tab", async () => {
    renderIt();
    await screen.findByRole("tab", { name: "Data" });
    expect(screen.queryByRole("tab", { name: "Statistics" })).toBeNull();
  });

  // The constraints endpoint is a *second* source, unlike Structure /
  // Indexes / DDL which all read the one up-front table-meta response. It
  // must stay unfetched until one of its two tabs opens.
  it("does not request constraints until the Constraints tab opens", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(calls().some((u) => u.includes("/constraints"))).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Constraints" }));
    await waitFor(() =>
      expect(calls().some((u) => u.includes("/constraints"))).toBe(true),
    );
    expect(await screen.findByText("users_email_ck")).toBeInTheDocument();
  });

  // Both tabs share one source, so opening the second issues no new request.
  it("serves the Foreign keys tab from the same constraints request", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Constraints" }));
    await screen.findByText("users_email_ck");
    const before = calls().filter((u) => u.includes("/constraints")).length;

    fireEvent.click(screen.getByRole("tab", { name: "Foreign keys" }));
    expect(await screen.findByText("fk_users_org")).toBeInTheDocument();
    expect(calls().filter((u) => u.includes("/constraints")).length).toBe(before);
  });

  it("shows row data on the default Data tab", async () => {
    renderIt();
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  // The inverse of postgres: one payload up front, no per-tab request. The
  // DDL text is bundled into the up-front `meta` fetch, so opening the DDL
  // tab renders it from state already held — this is what makes the test
  // genuinely distinguish "no new request" from "nothing was ever fetched".
  it("fetches once up front — opening DDL issues no new request", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    const before = calls().length;
    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    // The DDL panel's own "SHOW CREATE TABLE" label also matches a loose
    // /CREATE TABLE/ pattern, so match the fixture's actual DDL text.
    await screen.findByText(/CREATE TABLE `users`/);
    expect(calls().length).toBe(before);
  });

  it("offers a Truncate action", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getByRole("button", { name: /truncate/i })).toBeInTheDocument();
  });

  it("re-requests with an orderBy parameter when a column header is clicked", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    fireEvent.click(screen.getByText("email"));
    await waitFor(() => expect(calls().some((u) => u.includes("orderBy=email"))).toBe(true));
  });

  it("renders an error state when the rows request returns a non-200", async () => {
    restore();
    restore = mockFetch({
      "/tables/users$": { columns: COLUMNS, indexes: [], ddl: "", primaryKey: ["id"] },
      "/rows": httpError(502, "ER_ACCESS_DENIED_ERROR: access denied"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(screen.getByText(/ER_ACCESS_DENIED_ERROR/)).toBeInTheDocument();
  });

  // base-ui's Tabs unmounts inactive panels, and the default tab is Data —
  // so the meta-error ErrorState on Structure/Indexes/DDL (which all key off
  // `errors.meta`) is nowhere in the DOM until one of those tabs is opened.
  // Without clicking through, `findByRole("alert")` would resolve against
  // the Data tab's own (rows) alert instead — which happens to also render
  // here since `/rows` fails too — and pass even if all three `errors.meta`
  // branches were deleted. Click to Structure and match its specific title
  // so this actually exercises the meta error surface it's named for.
  it("renders an error state on the Structure tab when the meta request rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "/tables/users$": netFail("Failed to fetch"),
      "/rows": netFail("Failed to fetch"),
    });
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load structure/i);
  });

  // Guards the Data tab's onRetry against firing twice: the lazy-tab effect
  // (gated on `pageData === null && !errors.data`) is the sole caller of
  // loadData once a load has failed, so onRetry must clear only the error
  // key. A stray explicit loadData() call in onRetry — the shape the review
  // caught — would issue this request a second time, uncancelled (loadData
  // has no AbortController), racing the effect's own call.
  it("Retry after a failed rows load issues exactly one more rows request", async () => {
    restore();
    let attempt = 0;
    restore = mockFetch({
      "/tables/users$": META,
      "/rows": () => {
        attempt += 1;
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return ROWS;
      },
    });
    renderIt();
    await screen.findByRole("alert");
    const before = calls().filter((u) => u.includes("/rows")).length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("a@example.com");
    expect(calls().filter((u) => u.includes("/rows")).length).toBe(before + 1);
  });

  // Guards against Retry silently reloading page 0 instead of the page the
  // user was actually on when the load failed.
  it("Retry re-requests the offset the user was on, not page 0", async () => {
    restore();
    const BIG_ROWS = { ...ROWS, totalRows: 250 };
    let offset100Attempts = 0;
    restore = mockFetch({
      "/tables/users$": META,
      "/rows": (url: string) => {
        if (url.includes("offset=100")) {
          offset100Attempts += 1;
          if (offset100Attempts === 1) {
            return new Response(JSON.stringify({ error: "boom" }), {
              status: 502,
              headers: { "content-type": "application/json" },
            });
          }
        }
        return BIG_ROWS;
      },
    });
    renderIt();
    await screen.findByText("a@example.com");
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("a@example.com");
    const rowsCalls = calls().filter((u) => u.includes("/rows"));
    expect(rowsCalls[rowsCalls.length - 1]).toContain("offset=100");
  });

  // Guards against the fix for the above turning Retry into a dead button:
  // once loadData no longer nulls pageData on failure, a load that fails
  // *after* an earlier success would leave pageData non-null, the lazy-tab
  // effect's guard would never re-satisfy, and clicking Retry would only
  // clear the error — silently re-rendering the stale prior page instead of
  // issuing a new request. Distinct data on the recovering response is what
  // makes this test actually distinguish "a fetch happened" from "the old
  // data was still sitting in state".
  it("Retry recovers after a later load fails, not just the first one", async () => {
    restore();
    const ROWS_AFTER_RETRY = {
      columns: ["id", "email"],
      rows: [{ id: 3, email: "c@example.com" }],
      totalRows: 1,
      primaryKey: ["id"],
    };
    let attempt = 0;
    restore = mockFetch({
      "/tables/users$": META,
      "/rows": () => {
        attempt += 1;
        if (attempt === 1) return ROWS;
        if (attempt === 2) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return ROWS_AFTER_RETRY;
      },
    });
    renderIt();
    await screen.findByText("a@example.com");
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("c@example.com")).toBeInTheDocument();
  });

  // Rows-loaded-but-schema-failed: the Data tab is the default tab, so if
  // only the up-front `meta` request failed the user would otherwise see
  // rows with no column types, no PK markers, and both mutation buttons
  // silently disabled with no explanation in view.
  it("shows a compact schema-error banner above the data grid when rows load but meta fails", async () => {
    restore();
    restore = mockFetch({
      "/tables/users$": netFail("Failed to fetch"),
      "/rows": ROWS,
    });
    renderIt();

    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load column metadata/i);
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  it("does not show the schema-error banner on a full happy path", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // No "surfaces a fetch failure instead of spinning forever" test here.
  // loadData's fetch() has no .catch() — only a try/finally around
  // setLoadingData — and it fires unconditionally on mount (the default tab
  // is "data"). A rejected fetch (mockFetch with no matching route) makes
  // that mount-time call reject with nothing to await it, i.e. an unhandled
  // promise rejection, not rendered error text. Provoking that deliberately
  // would itself violate this suite's "no unhandled rejections" requirement,
  // so — same as postgres in task-4 — the behaviour isn't there to
  // characterize cleanly.
});
