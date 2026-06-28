import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { verifyUserPassword, updateUser } from "@/lib/auth/users";
import { revokeUserSessions } from "@/lib/auth/sessions";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  isHttps,
} from "@/lib/auth/session";

export const runtime = "nodejs";

// Per-user password rotation from Settings → Security. Reaching this route
// already requires a valid session (enforced by proxy.ts), and we re-prove the
// current password so a hijacked open tab can't silently rotate it. Any
// non-empty new password is accepted — no length or composition rules.
export async function POST(req: NextRequest) {
  const user = getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    newPassword?: unknown;
    currentPassword?: unknown;
  };
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";

  if (!verifyUserPassword(user, currentPassword)) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  if (!newPassword) {
    return NextResponse.json({ error: "Enter a new password" }, { status: 400 });
  }

  updateUser(user.id, { password: newPassword });

  // A password change invalidates this user's existing sessions on every device.
  // We then re-issue a fresh session for the current device so this tab stays
  // logged in; other devices for this user must re-authenticate.
  revokeUserSessions(user.id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, req.headers.get("user-agent") ?? ""),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
}
