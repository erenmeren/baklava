import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getSlowlog } from "@/lib/connections/redis";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const count = Number(req.nextUrl.searchParams.get("count") ?? "64");
  try {
    const entries = await getSlowlog(id, record.config as RedisConfig, count);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
