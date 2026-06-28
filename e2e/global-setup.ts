import { request } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Where the authenticated session is saved for all specs to reuse.
export const STORAGE_STATE = path.join(process.cwd(), "e2e", ".auth", "state.json");

// Baklava gates every page behind a single password once configured. The e2e
// dev server is booted with BAKLAVA_INITIAL_PASSWORD (see playwright.config.ts),
// so here we log in once and persist the session cookie; every project then
// loads it via `storageState` and lands on real app chrome instead of the
// first-run / login card.
export default async function globalSetup() {
  const baseURL =
    process.env.E2E_BASE_URL ??
    `http://localhost:${process.env.PORT ?? (process.env.CI ? 3100 : 3000)}`;
  const password = process.env.E2E_PASSWORD ?? "";

  const ctx = await request.newContext({ baseURL });
  try {
    // Password-only login: after the RBAC migration the seeded BAKLAVA_INITIAL_PASSWORD
    // becomes a single `admin` user, and the login route accepts password-only while
    // exactly one enabled user exists — so this keeps working unchanged. The session
    // we persist here is that migrated `admin` (the user every spec runs as).
    const res = await ctx.post("/api/auth/login", { data: { password } });
    if (!res.ok()) {
      throw new Error(
        `E2E auth login failed (HTTP ${res.status()}) against ${baseURL}. ` +
          `The e2e server must boot with BAKLAVA_INITIAL_PASSWORD === E2E_PASSWORD. ` +
          `If another dev server is already running on this port with a different ` +
          `password, stop it so Playwright can boot its own.`,
      );
    }
    mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
    await ctx.storageState({ path: STORAGE_STATE });
  } finally {
    await ctx.dispose();
  }
}
