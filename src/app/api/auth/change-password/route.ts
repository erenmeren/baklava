import { NextRequest, NextResponse } from "next/server";
import {
  setPassword,
  verifyPassword,
  mustChangePassword,
  DEFAULT_BOOTSTRAP_PASSWORD,
} from "@/lib/auth/store";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  isHttps,
} from "@/lib/auth/session";

export const runtime = "nodejs";

const MIN_LENGTH = 8;

// Reaching this route already requires a valid session (enforced by proxy.ts).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    newPassword?: unknown;
    currentPassword?: unknown;
  };
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";

  const forced = mustChangePassword();
  // A voluntary change (not the forced bootstrap one) must re-prove the current
  // password, so a hijacked open tab can't silently rotate it.
  if (!forced && !verifyPassword(currentPassword)) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (newPassword === DEFAULT_BOOTSTRAP_PASSWORD) {
    return NextResponse.json(
      { error: "Choose a different password from the default" },
      { status: 400 },
    );
  }

  setPassword(newPassword);

  // Re-issue the session so the change flow lands authenticated.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
}
