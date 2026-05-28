import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { info } from "@/lib/connections/redis";
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
  const section = req.nextUrl.searchParams.get("section") || undefined;
  try {
    const sections = await info(id, record.config as RedisConfig, section);
    updateStatus(id, "ok");
    return NextResponse.json({ sections });
  } catch (err) {
    const msg = formatError(err);
    updateStatus(id, "error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
