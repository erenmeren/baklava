import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

/**
 * One-time token for first-run setup. Until an admin exists, /api/auth/setup
 * is necessarily public — so on a console reachable from a network, whoever
 * got there first became admin. The token is printed to the server's own
 * output, which only the operator sees, and setup requires it.
 *
 * `BAKLAVA_SETUP_TOKEN` pre-sets it (scripted installs); `BAKLAVA_INITIAL_PASSWORD`
 * skips the setup flow altogether.
 */
const globalKey = Symbol.for("baklava.setupToken");

export function getSetupToken(): string {
  const g = globalThis as unknown as Record<symbol, string | undefined>;
  const existing = g[globalKey];
  if (existing) return existing;
  const fromEnv = process.env.BAKLAVA_SETUP_TOKEN?.trim();
  const token = fromEnv || randomBytes(12).toString("base64url");
  g[globalKey] = token;
  if (!fromEnv) {
    console.log(
      `\n[baklava] First-run setup — enter this setup token on the sign-in page to create the admin:\n\n    ${token}\n`,
    );
  }
  return token;
}

export function verifySetupToken(candidate: string): boolean {
  // Hash both sides so the compare is constant-time regardless of length.
  const a = createHash("sha256").update(candidate.trim()).digest();
  const b = createHash("sha256").update(getSetupToken()).digest();
  return timingSafeEqual(a, b);
}

export function _resetSetupTokenForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[globalKey];
}
