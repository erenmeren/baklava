import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { TableDetailClient } from "./table-detail-client";

// TableDetailClient reads `useRouter` / `usePathname` / `useSearchParams`
// from next/navigation. There is no App Router mounted in these tests, so
// the real hooks throw ("invariant expected app router to be mounted").
// Stub the module instead of adding a router-testing dependency.
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/postgres/c1/databases/appdb/schemas/public/tables/users",
  useSearchParams: () => new URLSearchParams(),
}));

// Shape matches ColumnInfo from src/lib/connections/postgres/catalog.ts —
// the "view=structure" API response, not the component's own guess.
const COLUMNS = [
  {
    name: "id",
    position: 1,
    dataType: "integer",
    isNullable: false,
    default: "nextval('users_id_seq'::regclass)",
    isPrimaryKey: true,
    isUnique: false,
    comment: null,
  },
  {
    name: "email",
    position: 2,
    dataType: "text",
    isNullable: false,
    default: null,
    isPrimaryKey: false,
    isUnique: true,
    comment: null,
  },
];

// Shape matches TableData from src/lib/connections/postgres/rows.ts — the
// "view=data" response. Rows are arrays-of-cells aligned with `fields`, not
// objects keyed by column name.
const ROWS = {
  fields: [
    { name: "id", dataType: "int4" },
    { name: "email", dataType: "text" },
  ],
  rows: [
    [1, "a@example.com"],
    [2, "b@example.com"],
  ],
  rowCount: 2,
  totalRows: 2,
};

const INDEXES = [
  {
    name: "users_pkey",
    definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
    isUnique: true,
    isPrimary: true,
    sizeBytes: 16384,
    scans: 42,
    tuplesRead: 84,
    tuplesFetched: 84,
    unused: false,
  },
];

const STATS = {
  relKind: "r",
  analyzed: true,
  rowEstimate: 2,
  totalSize: 16384,
  tableSize: 8192,
  indexSize: 8192,
  toastSize: 0,
  liveTuples: 2,
  deadTuples: 0,
  seqScan: 3,
  seqTupRead: 6,
  idxScan: 1,
  idxTupFetch: 1,
  nTupIns: 2,
  nTupUpd: 0,
  nTupDel: 0,
  nTupHotUpd: 0,
  vacuumCount: 0,
  autovacuumCount: 0,
  analyzeCount: 0,
  autoanalyzeCount: 0,
  lastVacuum: null,
  lastAutovacuum: null,
  lastAnalyze: null,
  lastAutoanalyze: null,
};

let restore: () => void;

beforeEach(() => {
  restore = mockFetch({
    "view=ddl": { ddl: "CREATE TABLE public.users (…);" },
    "view=stats": { stats: STATS },
    "view=indexes": { indexes: INDEXES },
    "view=constraints": { constraints: [] },
    "view=foreign_keys": { foreignKeys: [] },
    "view=structure": { columns: COLUMNS },
    "view=data": ROWS,
  });
});

afterEach(() => restore());

function renderIt() {
  return render(
    <TableDetailClient connectionId="c1" db="appdb" schema="public" table="users" />,
  );
}

function fetchedUrls(): string[] {
  return (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(
    (c) => c[0],
  );
}

// No "surfaces a fetch failure instead of spinning forever" test here — see
// task-4-report.md. The component's initial `loadData(0)` call (fired from a
// useEffect on mount) has no `.catch()` around its `fetch()`; a rejected
// fetch (mockFetch with no matching route, i.e. a total network failure)
// becomes an unhandled promise rejection, not a rendered error. There is no
// DOM text to assert on for that path, and provoking it deliberately would
// itself violate this suite's "no unhandled rejections" requirement — so the
// behaviour genuinely isn't there to characterize cleanly.

describe("postgres TableDetailClient (characterization)", () => {
  it("renders all seven tabs", async () => {
    renderIt();
    for (const label of [
      "Data",
      "Structure",
      "Indexes",
      "Constraints",
      "Foreign keys",
      "DDL",
      "Statistics",
    ]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("shows row data on the default Data tab", async () => {
    renderIt();
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  it("offers row-level insert, edit and delete", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getByRole("button", { name: /insert row/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /edit row/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /delete row/i }).length).toBeGreaterThan(0);
  });

  it("fetches per-tab: the DDL view is not requested until its tab opens", async () => {
    renderIt();
    // Wait for the initial mount fetches (structure + data) to settle so
    // the assertion below is about the DDL tab specifically, not just "no
    // fetches have happened yet".
    await screen.findByText("a@example.com");
    expect(fetchedUrls().some((u) => u.includes("view=ddl"))).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    await waitFor(() => expect(fetchedUrls().some((u) => u.includes("view=ddl"))).toBe(true));
    // And the DDL text itself renders once the fetch resolves — this is
    // what makes the test genuinely distinguish "fetched" from "rendered
    // from data that was already there".
    expect(await screen.findByText(/CREATE TABLE public\.users/)).toBeInTheDocument();
  });

  it("renders the column list on the Structure tab", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    expect(await screen.findByText("email")).toBeInTheDocument();
    expect(screen.getByText("integer")).toBeInTheDocument();
  });
});
