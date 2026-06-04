import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLICY,
  isAllowed,
  needsApproval,
  type PermissionPolicy,
} from "./permissions";

const autonomous: PermissionPolicy = {
  mode: "autonomous",
  read: true,
  write: true,
  destructive: false,
};

describe("permissions", () => {
  it("default policy is confirm + read-only", () => {
    expect(DEFAULT_POLICY).toEqual({
      mode: "confirm",
      read: true,
      write: false,
      destructive: false,
    });
  });

  it("isAllowed reflects per-category toggles", () => {
    expect(isAllowed("read", DEFAULT_POLICY)).toBe(true);
    expect(isAllowed("write", DEFAULT_POLICY)).toBe(false);
    expect(isAllowed("write", autonomous)).toBe(true);
    expect(isAllowed("destructive", autonomous)).toBe(false);
  });

  it("confirm mode requires approval for write + destructive, not read", () => {
    expect(needsApproval("read", DEFAULT_POLICY)).toBe(false);
    expect(needsApproval("write", { ...DEFAULT_POLICY, write: true })).toBe(true);
    expect(needsApproval("destructive", { ...DEFAULT_POLICY, destructive: true })).toBe(true);
  });

  it("autonomous mode skips approval for write but STILL confirms destructive by default", () => {
    expect(needsApproval("write", autonomous)).toBe(false);
    expect(
      needsApproval("destructive", { ...autonomous, destructive: true }),
    ).toBe(true);
  });

  it("autonomous mode can opt out of destructive confirmation explicitly", () => {
    expect(
      needsApproval("destructive", {
        ...autonomous,
        destructive: true,
        confirmDestructive: false,
      }),
    ).toBe(false);
  });
});
