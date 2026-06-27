import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  revokeSession(id);
  return NextResponse.json({ ok: true });
}
