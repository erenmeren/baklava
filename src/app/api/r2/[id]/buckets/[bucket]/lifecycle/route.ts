import { NextRequest, NextResponse } from "next/server";
import type { LifecycleRule } from "@aws-sdk/client-s3";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getBucketLifecycle, putBucketLifecycle } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({
      rules: await getBucketLifecycle(id, cfg, bucket),
    });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { rules?: LifecycleRule[] };
  try {
    body = (await req.json()) as { rules?: LifecycleRule[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await putBucketLifecycle(id, cfg, bucket, body.rules ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
