import { NextRequest, NextResponse } from "next/server";
import { getSession, revokeSession } from "@/lib/auth/sessions";
import { callerSession } from "@/lib/auth/caller-session";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = callerSession(req);
  if (!me) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Someone else's session looks exactly like a missing one.
  if (getSession(id)?.userId !== me.userId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  revokeSession(id);
  return NextResponse.json({ ok: true });
}
