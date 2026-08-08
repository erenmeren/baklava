import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { TableDetailClient } from "./table-detail-client";

// TableDetailClient reads `useRouter` / `usePathname` / `useSearchParams`
// from next/navigation (the ?modify=1 deep-link handling + the post-drop
// redirect). There is no App Router mounted in these tests, so the real
// hooks throw. Stub the module, same as the postgres characterization test.
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/sqlserver/c1/databases/appdb/tables/dbo/users",
  useSearchParams: () => new URLSearchParams(),
}));

// Shape matches SqlServerTableDetail from
// src/lib/connections/sqlserver/catalog.ts (getSqlServerTableDetail). The
// brief's fixture omitted `schema`/`table`/`isHeap`/`rowCount` — the
// component's description line calls `detail.rowCount.toLocaleString()`
// unconditionally once `detail` is set, which throws on `undefined`. It also
// named the index field `columns` instead of `keyColumns`, and dropped
// `typeDesc`/`sizeBytes`/usage counters/`unused` that the Indexes tab and
// buildClientDdl both read.
const DETAIL = {
  schema: "dbo",
  table: "users",
  isHeap: false,
  rowCount: 2,
  columns: [
    {
      name: "id",
      dataType: "int",
      nullable: false,
      isIdentity: true,
      identitySeed: "1",
      identityIncrement: "1",
      isComputed: false,
      computedDefinition: null,
      isPrimaryKey: true,
      defaultDefinition: null,
      maxLength: 4,
    },
    {
      name: "email",
      dataType: "nvarchar(255)",
      nullable: false,
      isIdentity: false,
      identitySeed: null,
      identityIncrement: null,
      isComputed: false,
      computedDefinition: null,
      isPrimaryKey: false,
      defaultDefinition: null,
      maxLength: 510,
    },
  ],
  indexes: [
    {
      name: "PK_users",
      typeDesc: "CLUSTERED",
      isPrimaryKey: true,
      isUnique: true,
      keyColumns: ["id"],
      includedColumns: [],
      sizeBytes: 16384,
      userSeeks: 10,
      userScans: 0,
      userLookups: 0,
      userUpdates: 2,
      unused: false,
    },
  ],
  constraints: [],
  foreignKeys: [],
};

// Shape matches SqlServerTableData from src/lib/connections/sqlserver/rows.ts
// (getSqlServerTableData) — the field is `fields`, not `columns` as the
// brief guessed; `TableData` inside the component is typed
// `{ fields: string[]; rows: unknown[][]; total: number }`.
const DATA = {
  fields: ["id", "email"],
  rows: [
    [1, "a@example.com"],
    [2, "b@example.com"],
  ],
  total: 2,
};

let restore: () => void;

function calls(): string[] {
  return (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  restore = mockFetch({
    // "/data" alone would also match the *detail* request — its URL is
    // `/api/sqlserver/.../databases/appdb/tables/dbo/users`, and
    // "databases" itself contains the substring "/data". loadData always
    // appends a query string (`/data?offset=...`), the detail fetch never
    // does, so "/data?" is the pattern that actually distinguishes them.
    "/data?": DATA,
    "/tables/dbo/users": DETAIL,
  });
});

afterEach(() => restore());

function renderIt() {
  return render(
    <TableDetailClient connectionId="c1" database="appdb" schema="dbo" table="users" />,
  );
}

describe("sqlserver TableDetailClient (characterization)", () => {
  it("renders six tabs and no Statistics tab", async () => {
    renderIt();
    for (const label of ["Data", "Structure", "Indexes", "Constraints", "Foreign keys", "DDL"]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Statistics" })).toBeNull();
  });

  it("shows row data on the default Data tab", async () => {
    renderIt();
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
  });

  // Phase 2 wires edit/delete up. insertSqlServerRow already exists on the
  // server side; only the UI for per-row edit/delete is missing. Paired with
  // the positive "Insert row" assertion so this can't pass off a component
  // that failed to render.
  it("offers insert but no per-row edit or delete today", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getByRole("button", { name: /insert row/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  // buildClientDdl assembles the DDL in the browser from the detail payload
  // already loaded up front — opening the tab issues no request of its own.
  it("renders the DDL tab without any DDL-specific request", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    const before = calls().length;
    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    expect(await screen.findByText(/CREATE TABLE/)).toBeInTheDocument();
    expect(calls().length).toBe(before);
  });

  it("renders the column list on the Structure tab", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    expect(await screen.findByText("email")).toBeInTheDocument();
    expect(screen.getByText("nvarchar(255)")).toBeInTheDocument();
  });

  // No "surfaces a fetch failure instead of spinning forever" test here.
  // Both loadDetail (no try/catch at all) and loadData (try/finally, no
  // catch) fire on mount via `void loadDetail()` / `void loadData(0)` —
  // the `void` explicitly discards the promise. A rejected fetch (mockFetch
  // with no matching route) turns that into an unhandled promise rejection
  // on mount, not rendered error text, so — same as postgres in task-4 and
  // mysql above — this behaviour isn't there to characterize cleanly.
});
