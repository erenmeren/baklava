import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { copyObject, deleteObjects } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cfg = rec.config as R2Config;
  let body: { from?: string; to?: string; move?: boolean };
  try {
    body = (await req.json()) as { from?: string; to?: string; move?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const from = body.from ?? "";
  const to = body.to ?? "";
  try {
    await copyObject(id, cfg, bucket, from, to);
    if (body.move && from !== to) {
      await deleteObjects(id, cfg, bucket, [from]);
    }
    return NextResponse.json({ ok: true, to });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
