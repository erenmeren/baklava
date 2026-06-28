import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getLoadTest, listRuns, runSummary } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!getLoadTest(id, user.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ runs: listRuns(id, user.id).map(runSummary) });
}
