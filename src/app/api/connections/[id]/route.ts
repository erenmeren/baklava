import { NextResponse } from "next/server";
import { deleteConnection, getConnection, publicView } from "@/lib/connections/store";
import { dropConnectionSessions } from "@/lib/connections/terminal-sessions";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  return NextResponse.json(publicView(record));
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const ok = deleteConnection(id);
  if (!ok) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  dropConnectionSessions(id);
  return NextResponse.json({ ok: true });
}
