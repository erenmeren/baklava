import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { presignGet } from "@/lib/connections/r2";

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
  let body: { key?: string; expiresIn?: number };
  try {
    body = (await req.json()) as { key?: string; expiresIn?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const url = await presignGet(
      id,
      rec.config as R2Config,
      bucket,
      body.key ?? "",
      Math.min(body.expiresIn ?? 3600, 604800),
    );
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
