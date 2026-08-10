import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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

// Any console.error at all is a failure — vitest only prints captured console
// output for failing tests, so a plain "did anything log?" check would miss a
// regression. Mirrors the guard the mysql characterization suite has carried
// since Task 3.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    throw new Error(`Unexpected console.error: ${String(args[0])}`);
  });
});
afterEach(() => consoleErrorSpy.mockRestore());

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

  it("retries the failed view when Retry is clicked, issuing exactly one more request", async () => {
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
    // One failed attempt so far — not two. A regression here (the lazy-tab
    // effect double-firing loadData on mount, or Retry both calling loadData
    // itself *and* leaving the effect's guard satisfied) would inflate this
    // before the click even happens.
    expect(fetchedUrls().filter((u) => u.includes("view=data")).length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // Exactly one more — not two more. Retry must not both call loadData
    // directly *and* leave the lazy-tab effect's guard satisfied to fire it
    // again on its own.
    expect(fetchedUrls().filter((u) => u.includes("view=data")).length).toBe(2);
  });

  it("retries at the page offset the user was on, not offset 0", async () => {
    restore();
    // Enough totalRows that the Data tab's "Next page" control is enabled
    // (pageSize defaults to 100) — offset=0 succeeds, offset=100 (the next
    // page) fails once and then succeeds on retry.
    const PAGE_ONE = { ...ROWS, totalRows: 250 };
    const PAGE_TWO = { ...ROWS, rows: [[3, "c@example.com"]], rowCount: 1, totalRows: 250 };
    let offset100Attempts = 0;
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": (url: string) => {
        if (url.includes("offset=0")) return PAGE_ONE;
        offset100Attempts += 1;
        if (offset100Attempts === 1) throw new TypeError("Failed to fetch");
        return PAGE_TWO;
      },
    });
    renderIt();
    await screen.findByText("a@example.com");

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(
      fetchedUrls().filter((u) => u.includes("view=data") && u.includes("offset=100")).length,
    ).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("c@example.com")).toBeInTheDocument();
    // The retry's request carried the same offset=100 the user was on — not
    // a reset back to offset=0.
    expect(
      fetchedUrls().filter((u) => u.includes("view=data") && u.includes("offset=100")).length,
    ).toBe(2);
    expect(fetchedUrls().filter((u) => u.includes("view=data") && u.includes("offset=0")).length).toBe(1);
  });

  // Guards the four post-mutation refresh sites (CreateIndexDialog's
  // onCreated, index rename, index drop, ModifyTableDialog's onApplied)
  // against pairing a cache-null with a stale error key that's never
  // cleared. The lazy-tab effect's guard is `indexes === null &&
  // !errors.indexes` — nulling the cache alone, without also clearing the
  // error, leaves that guard permanently unsatisfied and the stale
  // ErrorState (plus its "Retry" button) stuck on screen even though the
  // mutation that just ran succeeded. "New index" is the reachable path:
  // unlike the per-row rename/drop icons (which only render once the
  // indexes table itself has loaded, i.e. never while errors.indexes is
  // set), it's gated only on `!columns`, so it stays clickable while the
  // Indexes tab is showing a stale error.
  it("creating an index after the indexes view failed re-fetches and clears the stale error", async () => {
    restore();
    let indexAttempts = 0;
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": ROWS,
      "view=indexes": () => {
        indexAttempts += 1;
        if (indexAttempts === 1) {
          return new Response(JSON.stringify({ error: "ECONNREFUSED" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return { indexes: INDEXES };
      },
      // The create-index POST goes to `${base}/indexes` — distinct from the
      // GET's `?view=indexes` query string (no "/indexes" path substring).
      "/indexes": { index: { name: "idx_email" } },
    });
    renderIt();

    fireEvent.click(await screen.findByRole("tab", { name: "Indexes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load indexes/i);
    expect(indexAttempts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /new index/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "email" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^create$/i }));

    // The stale error clears and the freshly (re)fetched index list renders
    // — proving both that a new request went out (indexAttempts advanced)
    // and that the guard let it through.
    await waitFor(() => expect(indexAttempts).toBe(2));
    expect(await screen.findByText("users_pkey")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Same guard-pairing bug as the CreateIndexDialog test above, but for
  // ModifyTableDialog's onApplied, which nulls both `columns` and
  // `pageData`. Unlike the per-row index rename/drop icons (unreachable
  // while errors.indexes is set, because they only render once `indexes`
  // itself has loaded — and `indexes` truthy and errors.indexes truthy are
  // mutually exclusive by construction), the "Modify" button is reachable
  // here: it's gated on `!columns` alone (:405), entirely decoupled from
  // `errors.data`/`pageData`. So `view=structure` succeeding while the
  // concurrent `view=data` fails on the default Data tab leaves Modify
  // enabled right next to a stale "Could not load data" banner.
  it("applying a table modification after the data view failed re-fetches and clears the stale error", async () => {
    restore();
    let dataAttempts = 0;
    const ROWS_AFTER_MODIFY = {
      fields: [
        { name: "id", dataType: "int4" },
        { name: "email", dataType: "text" },
      ],
      rows: [
        [1, "a@example.com"],
        [2, "b@example.com"],
        [3, "c@example.com"],
      ],
      rowCount: 3,
      totalRows: 3,
    };
    restore = mockFetch({
      // A single anchored pattern covers every request to this path —
      // `view=structure`, `view=data` (twice), and the PATCH modify
      // request all share the same path (only the query string or method
      // differs), so declaring separate patterns for them would make more
      // than one match the same URL and mockFetch would reject it as
      // ambiguous (see src/test/fetch-mock.ts's doc comment: the "$"
      // anchor ignores the query string entirely). Branch inside instead.
      "/tables/users$": (url: string) => {
        if (url.includes("view=structure")) return { columns: COLUMNS };
        if (url.includes("view=data")) {
          dataAttempts += 1;
          if (dataAttempts === 1) {
            return new Response(JSON.stringify({ error: "ECONNREFUSED" }), {
              status: 502,
              headers: { "content-type": "application/json" },
            });
          }
          return ROWS_AFTER_MODIFY;
        }
        // No "view=" query string at all → the PATCH modify request.
        return { ok: true };
      },
    });
    renderIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(dataAttempts).toBe(1);

    // Modify is enabled (columns loaded) even though the Data tab is
    // showing a stale error.
    fireEvent.click(screen.getByRole("button", { name: /^modify$/i }));
    const dialog = await screen.findByRole("dialog");
    const emailNameInput = within(dialog).getByDisplayValue("email");
    const emailRow = emailNameInput.closest("tr");
    if (!emailRow) throw new Error("email row not found");
    fireEvent.click(within(emailRow).getByTitle("Drop column on apply"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^apply/i }));

    // The stale error clears and the freshly (re)fetched rows render —
    // proving both that a new view=data request went out and that the
    // guard let it through.
    await waitFor(() => expect(dataAttempts).toBe(2));
    expect(await screen.findByText("c@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Rows-loaded-but-schema-failed: the Data tab is the default tab in all
  // three SQL techs, so if only the schema-describing request failed the
  // user would otherwise see rows with no column types, no PK markers, and
  // both mutation buttons silently disabled with no explanation in view.
  it("shows a compact schema-error banner above the data grid when rows load but structure fails", async () => {
    restore();
    restore = mockFetch({
      "view=structure": httpError(502, "ECONNREFUSED 127.0.0.1:5432"),
      "view=data": ROWS,
    });
    renderIt();

    // Rows are visible...
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    // ...and the schema-error banner sits above them, distinguishable from
    // the rows error by title.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load column metadata/i);
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  it("does not show the schema-error banner on a full happy path", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
