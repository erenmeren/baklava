import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { fsCat } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { path?: string };
  if (!body.path?.trim()) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    const result = await fsCat(
      record.config as DockerConfig,
      cid,
      body.path
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
