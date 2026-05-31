import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { deleteBucket } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await deleteBucket(id, rec.config as R2Config, bucket);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
