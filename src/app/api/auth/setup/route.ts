import { NextRequest, NextResponse } from "next/server";
import { needsSetup, setPassword } from "@/lib/auth/store";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  isHttps,
} from "@/lib/auth/session";

export const runtime = "nodejs";

// First-run password creation. Public (the user has no session yet) but usable
// ONLY while the console is unconfigured — once a password exists this 409s, so
// it can't be abused to reset an existing one. Any non-empty password is fine;
// there are no length or composition rules.
export async function POST(req: NextRequest) {
  if (!needsSetup()) {
    return NextResponse.json(
      { error: "A password is already configured" },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { newPassword?: unknown };
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!newPassword) {
    return NextResponse.json({ error: "Enter a password" }, { status: 400 });
  }

  setPassword(newPassword);

  // Issue a session so the setup flow lands authenticated.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
}
