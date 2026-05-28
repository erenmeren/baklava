import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  delKey,
  getKey,
  setStringValue,
  setTtl,
} from "@/lib/connections/redis";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; key: string }>;
}

function readDb(req: NextRequest): number | undefined {
  const v = req.nextUrl.searchParams.get("db");
  return v !== null ? Number(v) : undefined;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, key } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const detail = await getKey(
      id,
      record.config as RedisConfig,
      decodeURIComponent(key),
      readDb(req),
    );
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface PatchBody {
  /** Replace a string key. */
  value?: string;
  /** Set TTL in seconds; -1 to persist (clear expiry). */
  ttl?: number;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id, key } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const decoded = decodeURIComponent(key);
  const db = readDb(req);
  try {
    if (typeof body.value === "string") {
      await setStringValue(id, record.config as RedisConfig, decoded, body.value, db);
    }
    if (typeof body.ttl === "number") {
      await setTtl(id, record.config as RedisConfig, decoded, body.ttl, db);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, key } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    await delKey(
      id,
      record.config as RedisConfig,
      decodeURIComponent(key),
      readDb(req),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
