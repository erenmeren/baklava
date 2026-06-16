import { describe, it, expect } from "vitest";
import { formatError, errorResponse } from "./errors";
import { DriverNotInstalledError } from "@/techs/contract";

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

  it("falls back to the error name when an HTTP error has no body or message", () => {
    const err = Object.assign(new Error(""), { name: "GatewayError", statusCode: 502 });
    expect(formatError(err)).toBe("HTTP 502: GatewayError");
  });

  it("falls back to 'request failed' when an HTTP error has no body, message, or name", () => {
    const err = Object.assign(new Error(""), { name: "", statusCode: 500 });
    expect(formatError(err)).toBe("HTTP 500: request failed");
  });

  it("ignores a non-string response body and uses the message", () => {
    const err = Object.assign(new Error("boom"), { statusCode: 500, responseBody: { not: "a string" } });
    expect(formatError(err)).toBe("HTTP 500: boom");
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

describe("formatError + DriverNotInstalledError", () => {
  it("returns the install-hint message", () => {
    const msg = formatError(new DriverNotInstalledError("postgres", "pg"));
    expect(msg).toContain("pg");
    expect(msg).toContain("npm i pg");
  });
});

describe("errorResponse", () => {
  it("returns 503 for a missing driver, 500 otherwise", () => {
    const r503 = errorResponse(new DriverNotInstalledError("postgres", "pg"));
    expect(r503.status).toBe(503);
    const r500 = errorResponse(new Error("boom"));
    expect(r500.status).toBe(500);
  });
});
