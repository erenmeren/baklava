import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRequestSecurity,
  getOrCreateInstanceToken,
  throwIfInsecure,
} from "../../lib/security";
import { instanceKeyPath } from "../../lib/config";

const ORIG = process.env.BAKLAVA_HOME;
let tmpHome = "";

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "baklava-sec-"));
  process.env.BAKLAVA_HOME = tmpHome;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.BAKLAVA_HOME;
  else process.env.BAKLAVA_HOME = ORIG;
});

describe("getOrCreateInstanceToken", () => {
  it("creates a fresh 64-char hex token on first call", () => {
    const t = getOrCreateInstanceToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(instanceKeyPath())).toBe(true);
  });

  it("reuses the same token on subsequent calls", () => {
    const a = getOrCreateInstanceToken();
    const b = getOrCreateInstanceToken();
    expect(a).toBe(b);
  });

  const skipOnWindows = process.platform === "win32" ? it.skip : it;
  skipOnWindows("writes the token file with mode 0600", () => {
    getOrCreateInstanceToken();
    const mode = statSync(instanceKeyPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("checkRequestSecurity", () => {
  function valid() {
    return {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      token: getOrCreateInstanceToken(),
      expectedPort: 3000,
    };
  }

  it("accepts a localhost browser request with the right token", () => {
    const r = checkRequestSecurity(valid());
    expect(r.ok).toBe(true);
  });

  it("accepts 127.0.0.1 as the origin", () => {
    const r = checkRequestSecurity({
      ...valid(),
      origin: "http://127.0.0.1:3000",
      host: "127.0.0.1:3000",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts the IPv6 loopback as the origin", () => {
    const r = checkRequestSecurity({
      ...valid(),
      origin: "http://[::1]:3000",
      host: "[::1]:3000",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a null Origin (CLI / curl) as long as Host + Token are right", () => {
    const r = checkRequestSecurity({ ...valid(), origin: null });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-local Host (DNS rebinding defense)", () => {
    const r = checkRequestSecurity({ ...valid(), host: "evil.example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_BAD_HOST");
  });

  it("rejects a missing Host header", () => {
    const r = checkRequestSecurity({ ...valid(), host: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_BAD_HOST");
  });

  it("rejects a cross-origin request (CSRF defense)", () => {
    const r = checkRequestSecurity({ ...valid(), origin: "https://evil.example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_BAD_ORIGIN");
  });

  it("rejects a localhost origin on the wrong port", () => {
    const r = checkRequestSecurity({ ...valid(), origin: "http://localhost:9999" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_BAD_ORIGIN");
  });

  it("rejects a missing token", () => {
    const r = checkRequestSecurity({ ...valid(), token: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_MISSING_TOKEN");
  });

  it("rejects a wrong token", () => {
    const r = checkRequestSecurity({ ...valid(), token: "a".repeat(64) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_MISSING_TOKEN");
  });

  it("rejects a token of the wrong length (constant-time fast path)", () => {
    const r = checkRequestSecurity({ ...valid(), token: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_CSRF_MISSING_TOKEN");
  });
});

describe("throwIfInsecure", () => {
  it("returns silently for ok", () => {
    expect(() => throwIfInsecure({ ok: true })).not.toThrow();
  });

  it("throws a BaklavaException with the right code for bad host", () => {
    expect(() =>
      throwIfInsecure({ ok: false, code: "E_CSRF_BAD_HOST", reason: "x" })
    ).toThrow(/E_CSRF_BAD_HOST/);
  });
});
