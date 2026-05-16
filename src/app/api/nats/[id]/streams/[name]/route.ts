import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import {
  deleteNatsStream,
  getNatsStream,
  purgeNatsStream,
} from "@/lib/connections/nats";
import type { NatsConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

function loadConfig(id: string): NatsConfig | NextResponse {
  const record = getConnection(id);
  if (!record || record.tech !== "nats") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  return record.config as NatsConfig;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const cfg = loadConfig(id);
  if (cfg instanceof NextResponse) return cfg;
  try {
    const stream = await getNatsStream(cfg, decodeURIComponent(name));
    updateStatus(id, "ok");
    return NextResponse.json({ stream });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const cfg = loadConfig(id);
  if (cfg instanceof NextResponse) return cfg;
  try {
    await deleteNatsStream(cfg, decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  // POST /api/nats/[id]/streams/[name] — action: purge
  const { id, name } = await ctx.params;
  const cfg = loadConfig(id);
  if (cfg instanceof NextResponse) return cfg;
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }
  if (body.action !== "purge") {
    return NextResponse.json(
      { error: "Unsupported action" },
      { status: 400 }
    );
  }
  try {
    await purgeNatsStream(cfg, decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
