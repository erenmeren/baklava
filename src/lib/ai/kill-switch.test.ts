import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isKillSwitchOn, setKillSwitch, _resetControlsForTests } from "./kill-switch";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-ks-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetControlsForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("kill switch", () => {
  it("defaults off", () => {
    expect(isKillSwitchOn()).toBe(false);
  });

  it("persists on, survives a cache reset (reload from disk), 0600", () => {
    setKillSwitch(true);
    expect(isKillSwitchOn()).toBe(true);
    const file = path.join(dir, "ai-controls.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    _resetControlsForTests();
    expect(isKillSwitchOn()).toBe(true);
  });

  it("turns back off", () => {
    setKillSwitch(true);
    setKillSwitch(false);
    expect(isKillSwitchOn()).toBe(false);
  });
});
