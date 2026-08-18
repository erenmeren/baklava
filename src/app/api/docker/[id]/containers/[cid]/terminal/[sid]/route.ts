import { NextRequest, NextResponse } from "next/server";
import { dropSession, getSession } from "@/lib/connections/terminal-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string; sid: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, cid, sid } = await ctx.params;
  const session = getSession(sid);
  // The proxy only gates the connection id in the *path*; a session belonging
  // to another connection (or container) must read as "not found" here, or any
  // user with access to one Docker host could reach every other host's
  // terminals.
  if (!session || session.connectionId !== id || session.containerId !== cid) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  dropSession(sid);
  return NextResponse.json({ ok: true });
}
