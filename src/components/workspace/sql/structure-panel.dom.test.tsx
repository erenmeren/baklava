import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
