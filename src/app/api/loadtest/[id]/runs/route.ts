import { NextResponse } from "next/server";
import { getLoadTest, listRuns, runSummary } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getLoadTest(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ runs: listRuns(id).map(runSummary) });
}
