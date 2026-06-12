import { NextResponse } from "next/server";
import { getRun } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id, runId } = await ctx.params;
  const run = getRun(id, runId);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}
