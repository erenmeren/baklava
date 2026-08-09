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
  });
});

afterEach(() => restore());

function renderIt() {
  return render(<TableDetailClient connectionId="c1" db="appdb" table="users" />);
}

describe("mysql TableDetailClient (characterization)", () => {
  it("renders exactly four tabs", async () => {
    renderIt();
    for (const label of ["Data", "Structure", "Indexes", "DDL"]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  // Phase 2 adds these. Their absence is the thing being recorded. Paired
  // with the positive assertion above (in the same suite) so this can't
  // pass vacuously off a component that failed to render at all.
  it("has no Constraints, Foreign keys or Statistics tab today", async () => {
    renderIt();
    await screen.findByRole("tab", { name: "Data" });
    expect(screen.queryByRole("tab", { name: "Constraints" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Foreign keys" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Statistics" })).toBeNull();
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

  it("renders an error state when the meta request rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "/tables/users$": netFail("Failed to fetch"),
      "/rows": netFail("Failed to fetch"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
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
