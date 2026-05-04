import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { removeNetwork } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; netId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, netId } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    await removeNetwork(record.config as DockerConfig, decodeURIComponent(netId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
