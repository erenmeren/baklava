import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { listObjects, deleteObjects } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const prefix = req.nextUrl.searchParams.get("prefix") ?? "";
  const token = req.nextUrl.searchParams.get("token");
  try {
    return NextResponse.json(
      await listObjects(id, cfg, bucket, prefix, token),
    );
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { keys?: string[] };
  try {
    body = (await req.json()) as { keys?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await deleteObjects(id, cfg, bucket, body.keys ?? []);
    return NextResponse.json({ ok: true, deleted: body.keys?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
