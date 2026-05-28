import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listKeys } from "@/lib/connections/redis";
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
  const pattern = req.nextUrl.searchParams.get("pattern") || undefined;
  const dbParam = req.nextUrl.searchParams.get("db");
  const db = dbParam !== null ? Number(dbParam) : undefined;
  try {
    const page = await listKeys(id, record.config as RedisConfig, { pattern, db });
    updateStatus(id, "ok");
    return NextResponse.json(page);
  } catch (err) {
    const msg = formatError(err);
    updateStatus(id, "error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
