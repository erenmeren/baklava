import { describe, it, expect } from "vitest";
import { encryptEnvelope, decryptEnvelope, isEnvelope } from "./envelope";

const material = Buffer.from("test-key-material", "utf8");

describe("envelope", () => {
  it("round-trips plaintext", () => {
    const blob = JSON.stringify({ password: "hunter2", host: "db" });
    const enc = encryptEnvelope(blob, material);
    expect(enc).not.toContain("hunter2");
    expect(isEnvelope(enc)).toBe(true);
    expect(decryptEnvelope(enc, material)).toBe(blob);
  });

  it("fails with the wrong key", () => {
    const enc = encryptEnvelope("secret", material);
    expect(() => decryptEnvelope(enc, Buffer.from("wrong", "utf8"))).toThrow();
  });

  it("detects tampering", () => {
    const enc = encryptEnvelope("secret", material);
    const o = JSON.parse(enc);
    o.data.ct = Buffer.from("tampered").toString("base64");
    expect(() => decryptEnvelope(JSON.stringify(o), material)).toThrow();
  });

  it("isEnvelope is false for plaintext JSON", () => {
    expect(isEnvelope(JSON.stringify({ version: 1, connections: [] }))).toBe(false);
    expect(isEnvelope("not json")).toBe(false);
  });
});
