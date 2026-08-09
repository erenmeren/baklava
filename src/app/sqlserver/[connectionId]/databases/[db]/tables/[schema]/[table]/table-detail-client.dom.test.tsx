import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockFetch, httpError, netFail } from "@/test/fetch-mock";
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
// buildClientDdl both read. Columns also carry `precision`/`scale` per
// SqlServerColumn (catalog.ts:288-302) — the component's local `Column`
// interface never reads them, but they're part of the real shape.
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
      precision: 10,
      scale: 0,
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
      precision: null,
      scale: null,
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
    // "$"-anchored: without the anchor this would also match the rows
    // request's URL (same path plus "/data?..."), now ambiguous against
    // "/data?" above and rejected by mockFetch — see
    // src/test/fetch-mock.ts's doc comment.
    "/tables/dbo/users$": DETAIL,
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

  // --- Task 4: error surfaces --------------------------------------------

  it("renders an error state when the detail request returns a non-200", async () => {
    restore();
    restore = mockFetch({
      "/tables/dbo/users$": httpError(502, "Login failed for user 'sa'."),
      "/data?": { fields: [], rows: [], total: 0 },
    });
    renderIt();
    // detailError only renders on the Structure/Indexes/Constraints/Foreign
    // keys/DDL panels (the Data panel only cares about dataError, per the
    // brief) — and TabsContent unmounts inactive panels entirely
    // (@base-ui/react/tabs's `keepMounted` defaults to false; verified with
    // a throwaway DOM dump before writing this). The default tab is "data",
    // so the detail alert is invisible until a non-Data tab is opened.
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load table/i);
    expect(screen.getByText(/Login failed for user/)).toBeInTheDocument();
  });

  it("renders an error state when the data request rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "/tables/dbo/users$": DETAIL,
      "/data?": netFail("Failed to fetch"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
  });

  // Guards the Data tab's onRetry against firing twice: the mount effect
  // (gated on `!data && !dataError`) is the sole caller of loadData once a
  // load has failed, so onRetry must clear only the error key. A stray
  // explicit loadData() call in onRetry would issue this request a second
  // time, uncancelled (loadData has no AbortController), racing the
  // effect's own call.
  it("Retry after a failed data load issues exactly one more data request", async () => {
    restore();
    let attempt = 0;
    restore = mockFetch({
      "/tables/dbo/users$": DETAIL,
      "/data?": () => {
        attempt += 1;
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return DATA;
      },
    });
    renderIt();
    await screen.findByRole("alert");
    const before = calls().filter((u) => u.includes("/data?")).length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("a@example.com");
    expect(calls().filter((u) => u.includes("/data?")).length).toBe(before + 1);
  });

  // Guards against Retry silently reloading offset 0 instead of the page
  // the user was actually on when the load failed.
  it("Retry re-requests the offset the user was on, not offset 0", async () => {
    restore();
    const BIG_DATA = { ...DATA, total: 250 };
    const PAGE_TWO = { fields: DATA.fields, rows: [[3, "c@example.com"]], total: 250 };
    let offset100Attempts = 0;
    restore = mockFetch({
      "/tables/dbo/users$": DETAIL,
      "/data?": (url: string) => {
        if (!url.includes("offset=100")) return BIG_DATA;
        offset100Attempts += 1;
        if (offset100Attempts === 1) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return PAGE_TWO;
      },
    });
    renderIt();
    await screen.findByText("a@example.com");

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(
      calls().filter((u) => u.includes("/data?") && u.includes("offset=100")).length,
    ).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("c@example.com")).toBeInTheDocument();
    // The retry's request carried the same offset=100 the user was on — not
    // a reset back to offset=0.
    expect(
      calls().filter((u) => u.includes("/data?") && u.includes("offset=100")).length,
    ).toBe(2);
    expect(calls().filter((u) => u.includes("/data?") && u.includes("offset=0")).length).toBe(1);
  });

  // Guards against the fix for the above turning Retry into a dead button:
  // once loadData no longer nulls `data` on failure, a load that fails
  // *after* an earlier success would leave `data` non-null, the mount
  // effect's guard would never re-satisfy, and clicking Retry would only
  // clear the error — silently re-rendering the stale prior page instead of
  // issuing a new request. Changing the page size (offset stays 0 both
  // times) forces a second, later load without conflating this with the
  // offset-preservation test above. Distinct data on the recovering
  // response is what makes this test actually distinguish "a fetch
  // happened" from "the old data was still sitting in state".
  it("Retry recovers after a later data load fails, not just the first", async () => {
    restore();
    const DATA_AFTER_RETRY = { fields: DATA.fields, rows: [[9, "z@example.com"]], total: 1 };
    let attempt = 0;
    restore = mockFetch({
      "/tables/dbo/users$": DETAIL,
      "/data?": () => {
        attempt += 1;
        if (attempt === 1) return DATA;
        if (attempt === 2) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return DATA_AFTER_RETRY;
      },
    });
    renderIt();
    await screen.findByText("a@example.com");
    fireEvent.change(screen.getByLabelText(/rows per page/i), { target: { value: "50" } });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("z@example.com")).toBeInTheDocument();
  });

  // SQL Server's detail loader is the second of two loaders with the exact
  // same double-fire hazard as Data — the brief calls this out explicitly.
  // Guards the Structure/Indexes/Constraints/Foreign keys/DDL panels'
  // shared Retry pattern against an explicit loadDetail() call in onRetry
  // racing the mount effect's own.
  it("Retry after a failed detail load issues exactly one more detail request", async () => {
    restore();
    let attempt = 0;
    restore = mockFetch({
      "/tables/dbo/users$": () => {
        attempt += 1;
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(DETAIL), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      "/data?": DATA,
    });
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    await screen.findByRole("alert");
    const before = calls().filter((u) => u.endsWith("/tables/dbo/users")).length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("email")).toBeInTheDocument();
    expect(calls().filter((u) => u.endsWith("/tables/dbo/users")).length).toBe(before + 1);
  });
});
