import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listRedisKeys } from "@/lib/connections/redis";
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

  const sp = req.nextUrl.searchParams;
  const pattern = sp.get("pattern") || "*";
  const cursor = sp.get("cursor") || "0";
  const count = Number(sp.get("count") ?? "100");

  try {
    const result = await listRedisKeys(record.config as RedisConfig, {
      pattern,
      cursor,
      count: Number.isFinite(count) && count > 0 ? count : 100,
    });
    updateStatus(id, "ok");
    return NextResponse.json(result);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
