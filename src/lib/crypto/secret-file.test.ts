import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSecretFileSync, writeSecretFileSync } from "./secret-file";

// What a file written by the removed encryption-at-rest feature looks like.
const LEGACY = JSON.stringify({ magic: "baklava-enc", v: 1, salt: "00", wrap: {}, data: {} });

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-sf-"));
  file = path.join(dir, "connections.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("secret-file", () => {
  it("round-trips as plain JSON", () => {
    writeSecretFileSync(file, JSON.stringify({ password: "hunter2" }));
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ password: "hunter2" });
    expect(JSON.parse(readSecretFileSync(file)!)).toEqual({ password: "hunter2" });
  });

  it("returns null for a missing file", () => {
    expect(readSecretFileSync(file)).toBeNull();
  });

  it("writes mode 0600 and leaves no temp file", () => {
    writeSecretFileSync(file, "{}");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(["connections.json"]);
  });

  it("refuses to read a file encrypted by an older version", () => {
    fs.writeFileSync(file, LEGACY);
    expect(() => readSecretFileSync(file)).toThrow(/older Baklava version/);
  });

  it("keeps a legacy encrypted file as .unreadable.bak before overwriting it", () => {
    fs.writeFileSync(file, LEGACY);
    writeSecretFileSync(file, JSON.stringify({ password: "new" }));
    expect(fs.readFileSync(`${file}.unreadable.bak`, "utf8")).toBe(LEGACY);
    expect(JSON.parse(readSecretFileSync(file)!)).toEqual({ password: "new" });
  });

  it("does not clobber an earlier .unreadable.bak", () => {
    fs.writeFileSync(`${file}.unreadable.bak`, "first");
    fs.writeFileSync(file, LEGACY);
    writeSecretFileSync(file, "{}");
    expect(fs.readFileSync(`${file}.unreadable.bak`, "utf8")).toBe("first");
  });
});
