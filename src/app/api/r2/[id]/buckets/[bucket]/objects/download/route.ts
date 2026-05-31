import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { presignGet } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const key = req.nextUrl.searchParams.get("key") ?? "";
  try {
    const url = await presignGet(id, rec.config as R2Config, bucket, key, 300);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
