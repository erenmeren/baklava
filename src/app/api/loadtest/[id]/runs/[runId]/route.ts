import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getRun } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id, runId } = await ctx.params;
  const run = getRun(id, user.id, runId);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}
