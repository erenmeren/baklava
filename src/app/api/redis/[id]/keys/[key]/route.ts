import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { deleteRedisKey, getRedisKey } from "@/lib/connections/redis";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; key: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, key } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const decoded = safeDecode(key);
  if (decoded == null) {
    return NextResponse.json({ error: "Invalid key encoding" }, { status: 400 });
  }
  try {
    const result = await getRedisKey(record.config as RedisConfig, decoded);
    updateStatus(id, "ok");
    return NextResponse.json(result);
  } catch (err) {
    const message = formatError(err);
    const notFound = /not found/i.test(message);
    if (!notFound) updateStatus(id, "error", message);
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 502 }
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, key } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const decoded = safeDecode(key);
  if (decoded == null) {
    return NextResponse.json({ error: "Invalid key encoding" }, { status: 400 });
  }
  try {
    await deleteRedisKey(record.config as RedisConfig, decoded);
    updateStatus(id, "ok");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
