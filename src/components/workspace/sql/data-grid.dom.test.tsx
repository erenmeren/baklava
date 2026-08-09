import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  // the real italic span. This test pins the actual DOM shape (a <span> with
  // the italic class) so deleting the `cell === null` branch is caught.
  it("renders the null cell through the italic span, not a bare JSON.stringify(null)", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    for (const node of screen.getAllByText("null")) {
      expect(node.tagName).toBe("SPAN");
      expect(node.className).toContain("italic");
    }
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
