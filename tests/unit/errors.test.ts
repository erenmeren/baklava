import { describe, it, expect } from "vitest";
import {
  ERROR_CODES,
  docsUrl,
  isBaklavaError,
  makeError,
  BaklavaException,
  type BaklavaErrorCode,
} from "../../lib/errors.js";

describe("error code registry", () => {
  it("has no duplicate codes", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it("every code starts with E_ (convention)", () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^E_[A-Z][A-Z0-9_]+$/);
  });

  it("every code resolves to a unique docs URL", () => {
    const urls = ERROR_CODES.map((c) => docsUrl(c));
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).toMatch(/^https:\/\/baklava\.dev\/docs\/errors\/E_/);
  });
});

describe("makeError", () => {
  it("produces a fully-shaped BaklavaError", () => {
    const e = makeError({
      code: "E_AI_KEY_MISSING",
      what: "ANTHROPIC_API_KEY not found",
      why: "AI is needed to translate NL into a query plan",
      fix: "Run baklava settings or set ANTHROPIC_API_KEY",
    });
    expect(e.code).toBe("E_AI_KEY_MISSING");
    expect(e.docs).toBe("https://baklava.dev/docs/errors/E_AI_KEY_MISSING");
    expect(e.raw).toBeUndefined();
  });

  it("preserves the raw payload when provided", () => {
    const e = makeError({
      code: "E_SOURCE_FETCH_FAILED",
      what: "fetch from Postgres failed",
      why: "connection dropped",
      fix: "retry",
      raw: { table: "users", attempt: 1 },
    });
    expect(e.raw).toEqual({ table: "users", attempt: 1 });
  });
});

describe("isBaklavaError", () => {
  it("accepts a real BaklavaError", () => {
    const e = makeError({
      code: "E_INTERNAL",
      what: "x",
      why: "y",
      fix: "z",
    });
    expect(isBaklavaError(e)).toBe(true);
  });

  it("rejects null and primitives", () => {
    expect(isBaklavaError(null)).toBe(false);
    expect(isBaklavaError(undefined)).toBe(false);
    expect(isBaklavaError("E_INTERNAL")).toBe(false);
    expect(isBaklavaError(42)).toBe(false);
  });

  it("rejects objects with a code that isn't in the registry", () => {
    expect(
      isBaklavaError({
        code: "E_NOT_REGISTERED" as BaklavaErrorCode,
        what: "x",
        why: "y",
        fix: "z",
        docs: "x",
      })
    ).toBe(false);
  });

  it("rejects objects missing required fields", () => {
    expect(isBaklavaError({ code: "E_INTERNAL" })).toBe(false);
  });
});

describe("BaklavaException", () => {
  it("carries the BaklavaError on .error", () => {
    const e = makeError({
      code: "E_PORT_IN_USE",
      what: "port 3000 is taken",
      why: "another process holds it",
      fix: "use --port",
    });
    const ex = new BaklavaException(e);
    expect(ex.error).toBe(e);
    expect(ex.message).toContain("E_PORT_IN_USE");
    expect(ex.message).toContain("port 3000 is taken");
    expect(ex).toBeInstanceOf(Error);
  });
});
