import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearLoginFailures,
  isLoginThrottled,
  recordLoginFailure,
  MAX_PER_ACCOUNT,
  MAX_PER_CLIENT,
  WINDOW_MS,
  _resetLoginThrottleForTests,
} from "./login-throttle";

const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

beforeEach(() => {
  _resetLoginThrottleForTests();
  delete process.env.BAKLAVA_TRUST_PROXY;
});
afterEach(() => delete process.env.BAKLAVA_TRUST_PROXY);

describe("login throttle", () => {
  it("locks an account after MAX_PER_ACCOUNT failures, until the window passes", () => {
    for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure("admin", h(), i);
    expect(isLoginThrottled("admin", h(), 100)).toBe(true);
    expect(isLoginThrottled("Admin ", h(), 100)).toBe(true); // same account
    expect(isLoginThrottled("admin", h(), WINDOW_MS + 100)).toBe(false);
  });

  it("rotating X-Forwarded-For doesn't reset the account's bucket", () => {
    for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure("admin", h(`10.0.0.${i}`), i);
    expect(isLoginThrottled("admin", h("10.9.9.9"), 100)).toBe(true);
  });

  it("one attacker hammering one account doesn't lock out another", () => {
    for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure("admin", h(), i);
    expect(isLoginThrottled("alice", h(), 100)).toBe(false);
  });

  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    for (let i = 0; i < MAX_PER_CLIENT; i++) recordLoginFailure(`user${i}`, h("1.2.3.4"), i);
    expect(isLoginThrottled("fresh", h("1.2.3.4"), 100)).toBe(false);
  });

  it("with a trusted proxy, spraying many accounts from one address is capped", () => {
    process.env.BAKLAVA_TRUST_PROXY = "1";
    for (let i = 0; i < MAX_PER_CLIENT; i++) recordLoginFailure(`user${i}`, h("1.2.3.4, 10.0.0.1"), i);
    expect(isLoginThrottled("fresh", h("1.2.3.4"), 100)).toBe(true);
    expect(isLoginThrottled("fresh", h("5.6.7.8"), 100)).toBe(false);
  });

  it("a successful login clears the account's bucket", () => {
    for (let i = 0; i < MAX_PER_ACCOUNT; i++) recordLoginFailure("admin", h(), i);
    clearLoginFailures("admin");
    expect(isLoginThrottled("admin", h(), 100)).toBe(false);
  });
});
