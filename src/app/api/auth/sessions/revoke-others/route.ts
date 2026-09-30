import { NextResponse } from "next/server";
import { revokeUserSessionsExcept } from "@/lib/auth/sessions";
import { callerSession } from "@/lib/auth/caller-session";

export const runtime = "nodejs";

// "Sign out my other devices" — the caller's own sessions, not everyone's.
export async function POST(req: Request) {
  const me = callerSession(req);
  if (!me) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  revokeUserSessionsExcept(me.userId, me.id);
  return NextResponse.json({ ok: true });
}
