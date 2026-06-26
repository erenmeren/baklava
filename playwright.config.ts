import { defineConfig, devices } from "@playwright/test";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { STORAGE_STATE } from "./e2e/global-setup";

// Single dev server boots once; light/dark are two projects that share it,
// each setting the baklava-theme cookie via storageState in their fixtures.
// Default to the standard dev port so we reuse a developer's running
// `npm run dev`. CI overrides to a dedicated port.
const PORT = Number(process.env.PORT ?? (process.env.CI ? 3100 : 3000));
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Baklava gates every page behind a single password once configured. Boot the
// e2e server with a known password in an isolated, throwaway data dir so the
// real ~/.baklava is never touched, then global-setup logs in for a session.
const E2E_PASSWORD = "e2e-test-password";
const E2E_DATA_DIR = path.join(os.tmpdir(), "baklava-e2e-data");
process.env.E2E_PASSWORD = E2E_PASSWORD; // read by global-setup (same process)
// Start from a clean slate each run so the seeded password always matches.
rmSync(E2E_DATA_DIR, { recursive: true, force: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
      },
    },
    {
      name: "chromium-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
      },
    },
  ],

  // Reuse a running dev server if one is already up on PORT; otherwise boot one.
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      BAKLAVA_DATA_DIR: E2E_DATA_DIR,
      BAKLAVA_INITIAL_PASSWORD: E2E_PASSWORD,
    },
  },
});
