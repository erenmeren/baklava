import { describe, it, expect } from "vitest";
import { formatCpu, formatMemory, parseCpu, parseMemoryBytes, percentOf } from "./usage";

describe("parseCpu", () => {
  it("reads nanocores, the unit metrics-server actually reports", () => {
    // 27848233n ≈ 27.8 millicores
    expect(parseCpu("27848233n")).toBeCloseTo(27.85, 1);
  });

  it("reads millicores", () => {
    expect(parseCpu("250m")).toBe(250);
  });

  it("reads microcores", () => {
    expect(parseCpu("1500u")).toBeCloseTo(1.5, 3);
  });

  it("reads whole cores", () => {
    expect(parseCpu("2")).toBe(2000);
    expect(parseCpu("0.5")).toBe(500);
  });

  it("returns null for nonsense or absence", () => {
    expect(parseCpu(undefined)).toBeNull();
    expect(parseCpu("")).toBeNull();
    expect(parseCpu("plenty")).toBeNull();
  });
});

describe("parseMemoryBytes", () => {
  it("reads the binary suffixes", () => {
    expect(parseMemoryBytes("531516Ki")).toBe(531516 * 1024);
    expect(parseMemoryBytes("64Mi")).toBe(64 * 1024 ** 2);
    expect(parseMemoryBytes("2Gi")).toBe(2 * 1024 ** 3);
  });

  it("reads plain bytes", () => {
    expect(parseMemoryBytes("1024")).toBe(1024);
  });

  it("reads the decimal suffixes kubernetes also allows", () => {
    expect(parseMemoryBytes("1M")).toBe(1_000_000);
    expect(parseMemoryBytes("1G")).toBe(1_000_000_000);
  });

  it("returns null for nonsense or absence", () => {
    expect(parseMemoryBytes(undefined)).toBeNull();
    expect(parseMemoryBytes("lots")).toBeNull();
  });
});

describe("formatCpu", () => {
  it("renders millicores under a core", () => {
    expect(formatCpu(27.85)).toBe("28m");
  });

  it("renders cores above one", () => {
    expect(formatCpu(2500)).toBe("2.5");
  });

  it("dashes on null", () => {
    expect(formatCpu(null)).toBe("—");
  });
});

describe("formatMemory", () => {
  it("renders the largest sane binary unit", () => {
    expect(formatMemory(18364 * 1024)).toBe("17.9 MiB");
    expect(formatMemory(2 * 1024 ** 3)).toBe("2 GiB");
  });

  it("dashes on null", () => {
    expect(formatMemory(null)).toBe("—");
  });
});

describe("percentOf", () => {
  it("is the usage share of capacity, rounded", () => {
    expect(percentOf(500, 2000)).toBe(25);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("is null when either side is missing or capacity is zero", () => {
    expect(percentOf(null, 2000)).toBeNull();
    expect(percentOf(500, null)).toBeNull();
    expect(percentOf(500, 0)).toBeNull();
  });
});
