import { describe, it, expect } from "vitest";
import { formatError } from "./errors";

describe("formatError", () => {
  it("returns the trimmed message for a normal Error", () => {
    expect(formatError(new Error("  boom  "))).toBe("boom");
  });

  it("appends the ECONN* code when present", () => {
    const err = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
    });
    expect(formatError(err)).toBe("connect failed (ECONNREFUSED)");
  });

  it("falls back to Name: code when message is empty but code is present", () => {
    const err = Object.assign(new Error(""), {
      name: "AggregateError",
      code: "ETIMEDOUT",
    });
    expect(formatError(err)).toBe("AggregateError: ETIMEDOUT");
  });

  it("unwraps AggregateError.errors into a joined message", () => {
    const inner1 = new Error("inner one");
    const inner2 = Object.assign(new Error("inner two"), {
      code: "ECONNREFUSED",
    });
    const agg = Object.assign(new Error(""), {
      name: "AggregateError",
      errors: [inner1, inner2],
    });
    expect(formatError(agg)).toBe("inner one; inner two (ECONNREFUSED)");
  });

  it("filters out empty / generic 'Error' inner messages so output stays clean", () => {
    const empty = Object.assign(new Error(""), { name: "Error" });
    const real = new Error("real reason");
    const agg = Object.assign(new Error(""), {
      name: "AggregateError",
      errors: [empty, real],
    });
    expect(formatError(agg)).toBe("real reason");
  });

  it("falls back to err.name when there's no message, no code, no inner errors", () => {
    const err = Object.assign(new Error(""), { name: "WeirdError" });
    expect(formatError(err)).toBe("WeirdError");
  });

  it("returns 'Unknown error' when even name is missing", () => {
    const err = Object.assign(new Error(""), { name: "" });
    expect(formatError(err)).toBe("Unknown error");
  });

  it("surfaces HTTP status + response body for APICallError-shaped errors", () => {
    const err = Object.assign(new Error("Bad Gateway"), {
      statusCode: 502,
      responseBody: '{"type":"error","error":{"message":"upstream unavailable"}}',
    });
    expect(formatError(err)).toBe(
      'HTTP 502: {"type":"error","error":{"message":"upstream unavailable"}}',
    );
  });

  it("falls back to the message when an HTTP error has no response body", () => {
    const err = Object.assign(new Error("not found"), { statusCode: 404 });
    expect(formatError(err)).toBe("HTTP 404: not found");
  });

  it("coerces non-Error values via String()", () => {
    expect(formatError("plain string")).toBe("plain string");
    expect(formatError(null)).toBe("null");
    expect(formatError(undefined)).toBe("undefined");
    expect(formatError(42)).toBe("42");
    expect(formatError({ toString: () => "obj" })).toBe("obj");
  });

  it("trims whitespace-only messages and falls through to name fallback", () => {
    const err = Object.assign(new Error("   "), { name: "Whitey" });
    expect(formatError(err)).toBe("Whitey");
  });
});
