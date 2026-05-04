import { NextRequest, NextResponse } from "next/server";
import { dropSession, getSession } from "@/lib/connections/terminal-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string; sid: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { sid } = await ctx.params;
  if (!getSession(sid)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  dropSession(sid);
  return NextResponse.json({ ok: true });
}
