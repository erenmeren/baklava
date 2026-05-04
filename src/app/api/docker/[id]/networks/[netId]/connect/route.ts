import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  connectContainerToNetwork,
  disconnectContainerFromNetwork,
} from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; netId: string }>;
}

interface Body {
  container?: string;
  action?: "connect" | "disconnect";
  aliases?: string[];
  force?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, netId } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.container) {
    return NextResponse.json({ error: "container is required" }, { status: 400 });
  }
  const networkId = decodeURIComponent(netId);
  try {
    if (body.action === "disconnect") {
      await disconnectContainerFromNetwork(
        record.config as DockerConfig,
        networkId,
        body.container,
        body.force
      );
    } else {
      await connectContainerToNetwork(
        record.config as DockerConfig,
        networkId,
        body.container,
        body.aliases
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
