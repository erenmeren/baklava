import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaTable, type MetaColumn } from "./meta-table";

interface Idx { name: string; unique: boolean }
const COLUMNS: MetaColumn<Idx>[] = [
  { header: "Name", cell: (i) => i.name },
  { header: "Kind", cell: (i) => (i.unique ? "unique" : "—") },
];
const ITEMS: Idx[] = [
  { name: "users_pkey", unique: true },
  { name: "idx_users_email", unique: false },
];

describe("MetaTable", () => {
  it("renders one row per item across the declared columns", () => {
    render(<MetaTable items={ITEMS} columns={COLUMNS} rowKey={(i) => i.name} empty="No indexes." />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("idx_users_email")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("renders the empty slot instead of a table when there are no items", () => {
    render(<MetaTable items={[]} columns={COLUMNS} rowKey={(i) => i.name} empty="No indexes." />);
    expect(screen.getByText("No indexes.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("applies a per-row class from rowClassName", () => {
    render(
      <MetaTable
        items={ITEMS}
        columns={COLUMNS}
        rowKey={(i) => i.name}
        rowClassName={(i) => (i.unique ? "bg-amber-500/5" : undefined)}
        empty="No indexes."
      />,
    );
    expect(screen.getByText("users_pkey").closest("tr")).toHaveClass("bg-amber-500/5");
  });
});
