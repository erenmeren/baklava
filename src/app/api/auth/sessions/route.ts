import { NextResponse } from "next/server";
import { listSessions } from "@/lib/auth/sessions";
import { callerSession } from "@/lib/auth/caller-session";

export const runtime = "nodejs";

// Your own devices only: other users' sessions (ids, user agents, activity) are
// not a member's business, and an admin ends them by disabling the user.
export async function GET(req: Request) {
  const me = callerSession(req);
  if (!me) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const sessions = listSessions()
    .filter((s) => s.userId === me.userId)
    .map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      userAgent: s.userAgent,
      current: s.id === me.id,
    }));
  return NextResponse.json({ sessions });
}
