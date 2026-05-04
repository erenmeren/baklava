import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { readContainerStats } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const stats = await readContainerStats(record.config as DockerConfig, cid);
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
