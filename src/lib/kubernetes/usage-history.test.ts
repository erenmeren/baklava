import { describe, expect, it } from "vitest";
import { appendSamples, historyMinutes, parseFormattedCpu, parseFormattedMemory } from "./usage-history";
import { formatCpu, formatMemory } from "./usage";

describe("usage history", () => {
  it("parses the table's formatted usage back to numbers", () => {
    expect(parseFormattedCpu(formatCpu(28))).toBe(28);
    expect(parseFormattedCpu(formatCpu(2500))).toBe(2500);
    expect(parseFormattedCpu("—")).toBeNull();
    expect(parseFormattedMemory(formatMemory(12.5 * 1024 ** 2))).toBe(12.5 * 1024 ** 2);
    expect(parseFormattedMemory(formatMemory(512))).toBe(512);
    expect(parseFormattedMemory("—")).toBeNull();
    expect(parseFormattedMemory(null)).toBeNull();
  });

  it("appends, caps at the ring size, drops vanished rows, keeps series on null", () => {
    let h = appendSamples({}, { a: 1, b: 5 }, 3);
    h = appendSamples(h, { a: 2, b: null }, 3);
    h = appendSamples(h, { a: 3 }, 3);
    h = appendSamples(h, { a: 4, c: 9 }, 3);
    expect(h).toEqual({ a: [2, 3, 4], c: [9] });
    expect(appendSamples({ b: [5] }, { b: null })).toEqual({ b: [5] });
  });

  it("labels the window in minutes", () => {
    expect(historyMinutes(0, 5000)).toBe(1);
    expect(historyMinutes(60, 5000)).toBe(5);
  });
});
