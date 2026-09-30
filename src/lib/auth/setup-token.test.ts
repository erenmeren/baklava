import { describe, it, expect, afterEach, vi } from "vitest";
import { getSetupToken, verifySetupToken, _resetSetupTokenForTests } from "./setup-token";

afterEach(() => {
  _resetSetupTokenForTests();
  delete process.env.BAKLAVA_SETUP_TOKEN;
  vi.restoreAllMocks();
});

describe("setup token", () => {
  it("is minted once, printed once, and stable", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const t = getSetupToken();
    expect(t.length).toBeGreaterThanOrEqual(16);
    expect(getSetupToken()).toBe(t);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain(t);
  });

  it("verifies only the exact token (surrounding whitespace ignored)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = getSetupToken();
    expect(verifySetupToken(` ${t} `)).toBe(true);
    expect(verifySetupToken(t.slice(1))).toBe(false);
    expect(verifySetupToken("")).toBe(false);
  });

  it("BAKLAVA_SETUP_TOKEN pre-sets it and isn't echoed", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.BAKLAVA_SETUP_TOKEN = "scripted-install-token";
    expect(getSetupToken()).toBe("scripted-install-token");
    expect(log).not.toHaveBeenCalled();
  });
});
