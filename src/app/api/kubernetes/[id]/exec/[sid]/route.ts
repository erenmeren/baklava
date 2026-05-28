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
  const { sid } = await ctx.params;
  if (!getExecSession(sid)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  dropExecSession(sid);
  return NextResponse.json({ ok: true });
}
