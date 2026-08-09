import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { mockFetch, httpError, netFail } from "@/test/fetch-mock";
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

  it("renders an error state when the data view returns a non-200", async () => {
    restore(); // drop the all-green mock installed in beforeEach
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": httpError(502, "ECONNREFUSED 127.0.0.1:5432"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(screen.getByText(/ECONNREFUSED 127\.0\.0\.1:5432/)).toBeInTheDocument();
    // The skeletons are gone — this is what "instead of spinning forever" means.
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });

  it("renders an error state when the data fetch rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": netFail("Failed to fetch"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
  });

  it("retries the failed view when Retry is clicked", async () => {
    restore();
    let attempt = 0;
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return ROWS;
      },
    });
    renderIt();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
