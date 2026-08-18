import { NextRequest, NextResponse } from "next/server";
import {
  dropExecSession,
  getExecSession,
} from "@/lib/connections/kubernetes-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; sid: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, sid } = await ctx.params;
  const session = getExecSession(sid);
  // The proxy only gates the connection id in the *path*; a session id that
  // belongs to a different connection must read as "not found" here, or any
  // user with access to one cluster could reach every other cluster's shells.
  if (!session || session.connectionId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  dropExecSession(sid);
  return NextResponse.json({ ok: true });
}
