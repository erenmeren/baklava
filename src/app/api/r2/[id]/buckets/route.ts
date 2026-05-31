import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { listBuckets, createBucket } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ buckets: await listBuckets(id, cfg) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  try {
    await createBucket(id, cfg, name);
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
