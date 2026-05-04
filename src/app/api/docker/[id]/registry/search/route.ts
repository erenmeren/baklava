import { NextRequest, NextResponse } from "next/server";
import { searchDockerHub } from "@/lib/dockerhub";
import { getConnection } from "@/lib/connections/store";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getConnection(id)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") || "1"));
  try {
    const results = await searchDockerHub(q, page);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
