import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { removeRegistry } from "@/lib/connections/registries";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; regId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, regId } = await ctx.params;
  if (!getConnection(id)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (!removeRegistry(id, regId)) {
    return NextResponse.json({ error: "Registry not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
