import { describe, it, expect } from "vitest";
import {
  listConstraints,
  listForeignKeys,
  groupForeignKeyRows,
  type ForeignKeyRow,
} from "./mysql-constraints";

// 203.0.113.0/24 is TEST-NET-3 — guaranteed unroutable, so any assertion that
// resolves fast proves the guard fired before the driver tried to connect.
const cfg = {
  host: "203.0.113.1",
  port: 1,
  database: "x",
  user: "u",
  password: "p",
  ssl: false,
};

describe("mysql constraint introspection guards", () => {
  it("rejects a database name that is not a bare identifier", async () => {
    await expect(
      listConstraints(cfg, "demo`; DROP DATABASE demo; --", "users"),
    ).rejects.toThrow(/database name/i);
  });

  it("rejects a table name that is not a bare identifier", async () => {
    await expect(listForeignKeys(cfg, "demo", "users; DROP TABLE users")).rejects.toThrow(
      /table name/i,
    );
  });

  it("lets clean identifiers past the guard (then fails to connect)", async () => {
    await expect(listConstraints(cfg, "demo", "users")).rejects.not.toThrow(
      /database name|table name/i,
    );
  }, 20000);
});

describe("groupForeignKeyRows", () => {
  const row = (over: Partial<ForeignKeyRow>): ForeignKeyRow => ({
    name: "fk_order_items_order",
    column_name: "order_id",
    ordinal: 1,
    ref_schema: "demo",
    ref_table: "orders",
    ref_column: "id",
    on_update: "NO ACTION",
    on_delete: "CASCADE",
    ...over,
  });

  it("collapses a single-column key into one entry", () => {
    expect(groupForeignKeyRows([row({})])).toEqual([
      {
        name: "fk_order_items_order",
        columns: ["order_id"],
        refSchema: "demo",
        refTable: "orders",
        refColumns: ["id"],
        onUpdate: "NO ACTION",
        onDelete: "CASCADE",
      },
    ]);
  });

  it("collapses a composite key into one entry, in ordinal order", () => {
    // Deliberately out of order in the input — the grouping must not rely on
    // the driver returning rows already sorted.
    const grouped = groupForeignKeyRows([
      row({ name: "fk_c", column_name: "b", ordinal: 2, ref_column: "rb" }),
      row({ name: "fk_c", column_name: "a", ordinal: 1, ref_column: "ra" }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].columns).toEqual(["a", "b"]);
    expect(grouped[0].refColumns).toEqual(["ra", "rb"]);
  });

  it("keeps separate constraints separate", () => {
    const grouped = groupForeignKeyRows([
      row({ name: "fk_a" }),
      row({ name: "fk_b", column_name: "product_id", ref_table: "products" }),
    ]);
    expect(grouped.map((f: { name: string }) => f.name)).toEqual(["fk_a", "fk_b"]);
  });

  it("returns an empty array for a table with no foreign keys", () => {
    expect(groupForeignKeyRows([])).toEqual([]);
  });
});
