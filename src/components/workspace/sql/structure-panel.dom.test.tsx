import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StructurePanel } from "./structure-panel";
import type { SqlColumn } from "./types";

const COLUMNS: SqlColumn[] = [
  { name: "id", position: 1, dataType: "integer", nullable: false, default: "nextval(…)", isPrimaryKey: true },
  { name: "email", position: 2, dataType: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
  { name: "note", position: 3, dataType: "text", nullable: true, default: null, isPrimaryKey: false, comment: "free text" },
];

describe("StructurePanel", () => {
  it("renders one row per column with its type", () => {
    render(<StructurePanel columns={COLUMNS} />);
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("free text")).toBeInTheDocument();
  });

  it("summarises pk / not-null / default counts", () => {
    render(<StructurePanel columns={COLUMNS} />);
    expect(screen.getByText(/3 columns · 1 pk · 2 not null · 1 with default/)).toBeInTheDocument();
  });

  it("filters by name, type and comment", () => {
    render(<StructurePanel columns={COLUMNS} />);
    fireEvent.change(screen.getByPlaceholderText(/filter by name/i), {
      target: { value: "free" },
    });
    expect(screen.getByText("note")).toBeInTheDocument();
    expect(screen.queryByText("email")).toBeNull();
  });

  it("shows an empty state when the filter matches nothing", () => {
    render(<StructurePanel columns={COLUMNS} />);
    fireEvent.change(screen.getByPlaceholderText(/filter by name/i), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/no columns match/i)).toBeInTheDocument();
  });

  it("hides the Extra column unless some column has one", () => {
    const { rerender } = render(<StructurePanel columns={COLUMNS} />);
    expect(screen.queryByRole("columnheader", { name: "Extra" })).toBeNull();
    rerender(
      <StructurePanel
        columns={[{ ...COLUMNS[0], extra: "auto_increment" }, ...COLUMNS.slice(1)]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Extra" })).toBeInTheDocument();
    expect(screen.getByText("auto_increment")).toBeInTheDocument();
  });

  it("renders caller-supplied chips and toolbar action", () => {
    render(
      <StructurePanel
        columns={COLUMNS}
        extraChips={(c) => (c.name === "email" ? <span>→ other.table.id</span> : null)}
        action={<button type="button">Modify columns</button>}
      />,
    );
    expect(screen.getByText("→ other.table.id")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modify columns" })).toBeInTheDocument();
  });

  // The primary-key chip reads "pk" for every caller, including MySQL, whose
  // native SHOW COLUMNS terminology is "pri" — the pre-shared MySQL panel
  // rendered "pri" (git show 5d3e40f, table-detail-client.tsx:1195) and lost
  // that wording when MySQL adopted this component. That's an intentional,
  // ruled-on standardisation (docs/superpowers/plans/2026-08-09-sql-refactor-phase-2.md,
  // Global Constraints), not an accident to be reverted, but the literal has
  // no other guard anywhere in the codebase now that MySQL's own copy is
  // gone — pin it here so it can't silently drift again (e.g. back to
  // "pri", or to "PK", "primary key", etc.).
  it('labels the primary-key chip exactly "pk"', () => {
    render(<StructurePanel columns={COLUMNS} />);
    const idRow = screen.getByText("id").closest("tr");
    if (!idRow) throw new Error("id row not found");
    expect(within(idRow).getByText("pk")).toBeInTheDocument();
  });

  // Same exposure as "pk" above — literals in the shared component with no
  // other guard. Pinned together so a future rewording of either doesn't
  // ship unnoticed the way "pri" -> "pk" did.
  it('labels the not-null and unique chips exactly "not null" / "unique"', () => {
    render(<StructurePanel columns={COLUMNS} />);
    const idRow = screen.getByText("id").closest("tr");
    const emailRow = screen.getByText("email").closest("tr");
    if (!idRow || !emailRow) throw new Error("row not found");
    expect(within(idRow).getByText("not null")).toBeInTheDocument();
    expect(within(emailRow).getByText("not null")).toBeInTheDocument();
    expect(within(emailRow).getByText("unique")).toBeInTheDocument();
  });
});
