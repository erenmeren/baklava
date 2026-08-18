import { describe, it, expect } from "vitest";
import { LIST_LIMIT, toList } from "./list";

const identity = (x: { n: number }) => x;

describe("toList", () => {
  it("maps the items through", () => {
    const out = toList({ items: [{ n: 1 }, { n: 2 }] }, identity);
    expect(out.rows).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("is not truncated when the server sent no continue token", () => {
    expect(toList({ items: [{ n: 1 }] }, identity).truncated).toBe(false);
    expect(toList({ items: [], metadata: {} }, identity).truncated).toBe(false);
  });

  it("is truncated when the server hands back a continue token", () => {
    const out = toList({ items: [{ n: 1 }], metadata: { _continue: "eyJ2IjoibWV0YSJ9" } }, identity);
    expect(out.truncated).toBe(true);
  });

  it("reports how many more the server says are left, when it says", () => {
    const out = toList(
      { items: [{ n: 1 }], metadata: { _continue: "tok", remainingItemCount: 4200 } },
      identity,
    );
    expect(out.remaining).toBe(4200);
  });

  it("leaves remaining null when the server doesn't estimate it", () => {
    expect(toList({ items: [{ n: 1 }], metadata: { _continue: "tok" } }, identity).remaining).toBe(
      null,
    );
  });

  it("handles a list with no items at all", () => {
    const out = toList({}, identity);
    expect(out.rows).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it("caps at a limit big enough to be useful and small enough to survive", () => {
    expect(LIST_LIMIT).toBeGreaterThanOrEqual(500);
    expect(LIST_LIMIT).toBeLessThanOrEqual(5000);
  });
});
