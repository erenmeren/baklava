import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { stackAction } from "@/lib/connections/compose";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

interface Body {
  action?: "start" | "stop" | "restart";
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (
    body.action !== "start" &&
    body.action !== "stop" &&
    body.action !== "restart"
  ) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  try {
    const result = await stackAction(
      record.config as DockerConfig,
      decodeURIComponent(name),
      body.action
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
