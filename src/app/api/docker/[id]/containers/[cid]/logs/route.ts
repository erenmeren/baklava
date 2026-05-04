import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { readContainerLogs } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const tail = Number(req.nextUrl.searchParams.get("tail") || "200");
  try {
    const text = await readContainerLogs(
      record.config as DockerConfig,
      cid,
      tail
    );
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
