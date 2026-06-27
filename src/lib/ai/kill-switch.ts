import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function dataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function file(): string {
  return path.join(dataDir(), "ai-controls.json");
}

const globalKey = Symbol.for("baklava.aiControls");
interface Controls {
  killSwitch: boolean;
}

function load(): Controls {
  const g = globalThis as unknown as Record<symbol, Controls>;
  if (g[globalKey]) return g[globalKey];
  let c: Controls = { killSwitch: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Controls>;
    c = { killSwitch: parsed.killSwitch === true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[baklava] could not read ${file()}:`, err);
    }
  }
  return (g[globalKey] = c);
}

function persist(c: Controls): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error(`[baklava] could not persist ${file()}:`, err);
  }
}

export function isKillSwitchOn(): boolean {
  return load().killSwitch;
}

export function setKillSwitch(on: boolean): void {
  const c = load();
  c.killSwitch = on;
  persist(c);
  (globalThis as unknown as Record<symbol, Controls>)[globalKey] = c;
}

export function _resetControlsForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[globalKey];
}
