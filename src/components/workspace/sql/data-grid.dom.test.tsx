import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DataGrid, GridToolbar, filterRows, type GridColumn } from "./data-grid";

const COLUMNS: GridColumn[] = [
  { name: "id", hint: "int4 · NOT NULL", isPrimaryKey: true },
  { name: "email", hint: "text" },
  { name: "meta", hint: "jsonb" },
];
const ROWS: unknown[][] = [
  [1, "a@example.com", { tier: "gold" }],
  [2, null, null],
  [3, "c@example.com", true],
];

describe("filterRows", () => {
  it("matches case-insensitively across every cell", () => {
    expect(filterRows(ROWS, "A@EXAMPLE")).toEqual([ROWS[0]]);
  });
  it("searches inside serialized objects", () => {
    expect(filterRows(ROWS, "gold")).toEqual([ROWS[0]]);
  });
  it("never matches a null cell", () => {
    expect(filterRows(ROWS, "null")).toEqual([]);
  });
  it("returns every row for an empty or whitespace query", () => {
    expect(filterRows(ROWS, "   ")).toEqual(ROWS);
  });
});

describe("DataGrid", () => {
  it("renders a header per column with its hint, and every cell", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("int4 · NOT NULL")).toBeInTheDocument();
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
  });

  it("renders null cells as an italic null, objects as JSON, booleans as text", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    expect(screen.getAllByText("null").length).toBeGreaterThan(0);
    expect(screen.getByText('{"tier":"gold"}')).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("renders the empty slot when there are no rows", () => {
    render(<DataGrid columns={COLUMNS} rows={[]} density="compact" empty="No rows match “zz”." />);
    expect(screen.getByText("No rows match “zz”.")).toBeInTheDocument();
  });

  it("calls onToggleSort with the clicked column when sorting is enabled", () => {
    const onToggleSort = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        density="compact"
        sort={{ column: "id", dir: "asc" }}
        onToggleSort={onToggleSort}
        empty="No rows."
      />,
    );
    fireEvent.click(screen.getByRole("columnheader", { name: /email/ }));
    expect(onToggleSort).toHaveBeenCalledWith("email");
  });

  it("does not make headers clickable when sorting is not wired", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    fireEvent.click(screen.getByRole("columnheader", { name: /email/ }));
    // No throw, no handler — the assertion is simply that nothing is wired.
    expect(screen.getByRole("columnheader", { name: /email/ })).toBeInTheDocument();
  });

  it("renders row actions in a trailing cell", () => {
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        density="compact"
        rowActions={(_row, i) => <button type="button">edit {i}</button>}
        empty="No rows."
      />,
    );
    expect(screen.getByRole("button", { name: "edit 0" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^edit / })).toHaveLength(3);
  });

  // Added beyond the brief's Step 1 suite: `typeof null === "object"` in JS,
  // so a null cell falling through to the object branch would still render
  // the literal text "null" via JSON.stringify(null) — the assertion above
  // ("renders null cells as an italic null...") can't tell that apart from
  // the real italic span. This is also the fix-round-1 pin for the ruled-on
  // convergence decision: SQL Server's old `NULL` (uppercase, non-italic)
  // is deliberately standardised on this literal now — see the report.
  //
  // Scoped with within(tbody) rather than a page-wide screen query: the
  // header hint "int4 · NOT NULL" (COLUMNS[0]) contains the substring
  // "NULL" too, and Task 6's pk-badge guard was nearly hollow for exactly
  // this reason — matching prose elsewhere on the page instead of the cell
  // under test. within(tbody) rules that out structurally, and the closest
  // "thead" assertion below is a second, independent check of the same
  // thing.
  it("renders the null cell as an italic span inside the table body, not header hint text", () => {
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />,
    );
    const tbody = container.querySelector("tbody");
    if (!tbody) throw new Error("tbody not found");
    const nullNodes = within(tbody).getAllByText("null");
    expect(nullNodes).toHaveLength(2); // ROWS[1] has exactly two null cells
    for (const node of nullNodes) {
      expect(node.tagName).toBe("SPAN");
      expect(node.className).toBe("text-muted-foreground/50 italic");
      expect(node.closest("thead")).toBeNull();
    }
  });

  // Added in fix round 1: no test pinned the object-cell literal or its
  // styling before now — deleting the JSON.stringify branch (falling to
  // String(cell) -> "[object Object]") was only caught indirectly by the
  // "renders null cells..." test's unrelated object-cell assertion, which
  // doesn't check the class or element shape.
  it("renders an object cell as brand-colored JSON, scoped to its own cell", () => {
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />,
    );
    const tbody = container.querySelector("tbody");
    if (!tbody) throw new Error("tbody not found");
    const node = within(tbody).getByText('{"tier":"gold"}');
    expect(node.tagName).toBe("SPAN");
    expect(node.className).toBe("text-brand");
  });

  // Added in fix round 1: same exposure as the object cell, for booleans.
  it("renders a boolean cell as brand-colored text, scoped to its own cell", () => {
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />,
    );
    const tbody = container.querySelector("tbody");
    if (!tbody) throw new Error("tbody not found");
    const node = within(tbody).getByText("true");
    expect(node.tagName).toBe("SPAN");
    expect(node.className).toBe("text-brand");
  });

  // Added in fix round 1: restores MySQL's "Click to sort" hover affordance
  // as a title on sortable headers, and guards it against leaking onto
  // Postgres/SQL Server's non-sortable headers.
  it("shows a sort-hint title on headers when sorting is wired", () => {
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        density="compact"
        onToggleSort={() => {}}
        empty="No rows."
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: /email/ }),
    ).toHaveAttribute("title", "Click to sort");
  });

  it("does not add a sort-hint title when sorting is not wired", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    expect(
      screen.getByRole("columnheader", { name: /email/ }),
    ).not.toHaveAttribute("title");
  });

  // Added beyond the brief's Step 1 suite: none of the given tests render
  // both densities, so a regression that collapses cellPad/headPad to a
  // fixed string would pass all 11 unedited.
  it("switches cell and header padding when density changes", () => {
    const { container, rerender } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />,
    );
    const compactCell = container.querySelector("tbody td");
    const compactHead = container.querySelector("thead th");
    expect(compactCell?.className).toContain("py-1");
    expect(compactCell?.className).not.toContain("py-2");
    expect(compactHead?.className).toContain("py-1.5");

    rerender(<DataGrid columns={COLUMNS} rows={ROWS} density="normal" empty="No rows." />);
    const normalCell = container.querySelector("tbody td");
    const normalHead = container.querySelector("thead th");
    expect(normalCell?.className).toContain("py-2");
    expect(normalCell?.className).not.toContain("py-1 ");
    expect(normalHead?.className).toContain("py-2.5");
  });

  // Added beyond the brief's Step 1 suite: the brief's Step 3 says the
  // trailing actions <th>/<td> should render "only when rowActions is set".
  // No given test renders DataGrid *without* rowActions and inspects the
  // header cell count, so an unconditional trailing <th> would pass all 11.
  it("omits the trailing actions header cell when rowActions is not provided", () => {
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />,
    );
    expect(container.querySelectorAll("thead th").length).toBe(COLUMNS.length);
  });

  // Fix round 2 — Critical: a caller that needs the grid to be a bounded
  // flex item (SQL Server's Data tab, so DataPagination stays pinned below
  // instead of the whole page scrolling) must land its sizing classes on
  // the *same* element that carries overflow-auto, not a wrapping div.
  // Wrapping DataGrid in an outer flex-1/min-h-0 div doesn't work: DataGrid's
  // own div would still be a plain block child with auto height, so
  // overflow-auto on it never triggers and the box model silently breaks —
  // invisible to jsdom (no layout engine) and to Playwright (only checks
  // for an error banner), which is why this needs a structural DOM
  // assertion instead: the className must merge onto the same node as
  // "overflow-auto", not appear on some ancestor.
  it("merges a caller className onto the same element that carries overflow-auto", () => {
    const { container } = render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        density="compact"
        empty="No rows."
        className="flex-1 min-h-0"
      />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("overflow-auto");
    expect(wrapper?.className).toContain("flex-1");
    expect(wrapper?.className).toContain("min-h-0");
  });

  // Fix round 2 — Important: the MySQL client derives `filteredObjects` and
  // `filteredGridRows` from the same filter+map pair so `rowActions`
  // indexing stays correct after filtering (see table-detail-client.tsx).
  // That correctness rests entirely on DataGrid's contract: `rowActions`
  // must receive the row actually rendered at its position in the *already
  // filtered* `rows` array DataGrid was given, not some index into a larger
  // or differently-ordered set. This test pins that contract directly, so a
  // future change to DataGrid's iteration (e.g. an off-by-one, or indexing
  // into something other than the `rows` prop) fails here — independent of
  // whether MySQL's own two-array derivation still happens to agree.
  it("passes rowActions the row actually displayed at that position in the (pre-filtered) rows array", () => {
    const fullRows: unknown[][] = [
      [1, "keep-a"],
      [2, "drop-b"],
      [3, "keep-c"],
    ];
    // Mirrors what a caller does before ever handing rows to DataGrid —
    // MySQL's filteredObjects/filteredGridRows split does exactly this.
    const filtered = filterRows(fullRows, "keep");
    expect(filtered).toEqual([
      [1, "keep-a"],
      [3, "keep-c"],
    ]);
    const received: Array<{ row: unknown[]; index: number }> = [];
    render(
      <DataGrid
        columns={[{ name: "id" }, { name: "label" }]}
        rows={filtered}
        density="compact"
        rowActions={(row, i) => {
          received.push({ row, index: i });
          return (
            <button type="button">act {i}</button>
          );
        }}
        empty="No rows."
      />,
    );
    expect(received).toEqual([
      { row: [1, "keep-a"], index: 0 },
      { row: [3, "keep-c"], index: 1 },
    ]);
  });
});

describe("GridToolbar", () => {
  it("reports filter and density changes", () => {
    const onFilterChange = vi.fn();
    const onDensityChange = vi.fn();
    render(
      <GridToolbar
        filter=""
        onFilterChange={onFilterChange}
        density="compact"
        onDensityChange={onDensityChange}
        status="3 rows"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/filter rows/i), {
      target: { value: "abc" },
    });
    expect(onFilterChange).toHaveBeenCalledWith("abc");
    fireEvent.click(screen.getByTitle("Normal rows"));
    expect(onDensityChange).toHaveBeenCalledWith("normal");
    expect(screen.getByText("3 rows")).toBeInTheDocument();
  });
});
