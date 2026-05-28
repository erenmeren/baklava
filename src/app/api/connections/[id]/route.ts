import { NextResponse } from "next/server";
import {
  deleteConnection,
  getConnection,
  publicView,
  updateConnection,
} from "@/lib/connections/store";
import { dropConnectionSessions } from "@/lib/connections/terminal-sessions";
import { dropKubernetesClient } from "@/lib/connections/kubernetes";
import { dropConnectionExecSessions } from "@/lib/connections/kubernetes-sessions";
import { dropRedisClient } from "@/lib/connections/redis";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  return NextResponse.json(publicView(record));
}

interface PatchBody {
  name?: string;
  config?: Record<string, unknown>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = getConnection(id);
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    body.name === undefined &&
    (body.config === undefined || Object.keys(body.config).length === 0)
  ) {
    return NextResponse.json(
      { error: "Nothing to update — provide name or config" },
      { status: 400 }
    );
  }
  const updated = updateConnection(id, body);
  if (!updated) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  return NextResponse.json(publicView(updated));
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const ok = deleteConnection(id);
  if (!ok) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  dropConnectionSessions(id);
  dropConnectionExecSessions(id);
  dropKubernetesClient(id);
  dropRedisClient(id);
  return NextResponse.json({ ok: true });
}
