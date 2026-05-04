import { NextRequest, NextResponse } from "next/server";
import { listTags } from "@/lib/dockerhub";
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
  const namespace = req.nextUrl.searchParams.get("namespace") || "library";
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const tags = await listTags(namespace, name);
    return NextResponse.json({ tags });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
