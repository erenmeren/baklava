import { describe, it, expect } from "vitest";
import {
  applyDelete,
  applyReset,
  applyUpsert,
  rowKey,
  type LiveList,
} from "./watch-merge";

interface Row {
  name: string;
  namespace?: string;
  status?: string;
  cpuUsage?: string | null;
}

function list(rows: Row[], extra: Partial<LiveList<Row>> = {}): LiveList<Row> {
  return { rows, truncated: false, remaining: null, keep: [], newestFirst: false, ...extra };
}

describe("watch merge", () => {
  it("keys rows like ResourceTable does", () => {
    expect(rowKey({ name: "a", namespace: "demo" })).toBe("demo/a");
    expect(rowKey({ name: "node-1" })).toBe("/node-1");
  });

  it("replaces a changed row in place", () => {
    const s = list([{ name: "a", namespace: "d", status: "Pending" }, { name: "b", namespace: "d" }]);
    const next = applyUpsert(s, { name: "a", namespace: "d", status: "Running" });
    expect(next.rows.map((r) => r.status)).toEqual(["Running", undefined]);
  });

  it("inserts a new row in namespace/name order", () => {
    const s = list([{ name: "a", namespace: "d" }, { name: "c", namespace: "d" }]);
    expect(applyUpsert(s, { name: "b", namespace: "d" }).rows.map((r) => r.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(applyUpsert(s, { name: "z", namespace: "d" }).rows.at(-1)?.name).toBe("z");
  });

  it("puts new rows on top for newest-first lists", () => {
    const s = list([{ name: "old", namespace: "d" }], { newestFirst: true });
    expect(applyUpsert(s, { name: "new", namespace: "d" }).rows[0].name).toBe("new");
  });

  it("never grows a truncated list past what was fetched", () => {
    const s = list([{ name: "a", namespace: "d" }], { truncated: true, remaining: 5 });
    expect(applyUpsert(s, { name: "b", namespace: "d" })).toBe(s);
    // …but still updates and deletes rows it shows.
    expect(applyUpsert(s, { name: "a", namespace: "d", status: "x" }).rows[0].status).toBe("x");
    expect(applyDelete(s, "d/a").rows).toEqual([]);
  });

  it("deletes by key and is a no-op for unknown keys", () => {
    const s = list([{ name: "a", namespace: "d" }]);
    expect(applyDelete(s, "d/a").rows).toEqual([]);
    expect(applyDelete(s, "d/zz")).toBe(s);
  });

  it("keeps the last known usage the watch can't see", () => {
    const s = list([{ name: "a", namespace: "d", cpuUsage: "5m" }], { keep: ["cpuUsage"] });
    const up = applyUpsert(s, { name: "a", namespace: "d", status: "Running", cpuUsage: null });
    expect(up.rows[0]).toEqual({ name: "a", namespace: "d", status: "Running", cpuUsage: "5m" });
  });

  it("reset adopts the new list and its hints, carrying kept fields", () => {
    const s = list([{ name: "a", namespace: "d", cpuUsage: "5m" }, { name: "gone", namespace: "d" }]);
    const next = applyReset(s, {
      rows: [{ name: "a", namespace: "d", cpuUsage: null }, { name: "b", namespace: "d", cpuUsage: null }],
      truncated: true,
      remaining: 3,
      keep: ["cpuUsage"],
      newestFirst: false,
    });
    expect(next.rows).toEqual([
      { name: "a", namespace: "d", cpuUsage: "5m" },
      { name: "b", namespace: "d", cpuUsage: null },
    ]);
    expect(next.truncated).toBe(true);
    expect(next.remaining).toBe(3);
  });
});
