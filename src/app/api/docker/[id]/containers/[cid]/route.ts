import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { containerAction, inspectContainer, dockerErrorStatus } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveAccess } from "@/lib/connections/access";
import { redactContainerEnv } from "@/lib/ai/tools/docker";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

type Action =
  | "start"
  | "stop"
  | "restart"
  | "kill"
  | "pause"
  | "unpause";

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const data = await inspectContainer(record.config as DockerConfig, cid);
    // Config.Env is where containers keep their passwords and API keys: a
    // `read` grant sees the variable names, the values need write.
    const user = getCurrentUser(req);
    const canSeeEnv =
      !!user &&
      effectiveAccess({
        user: { id: user.id, role: user.role },
        conn: { id, ownerId: record.ownerId },
      }) === "write";
    return NextResponse.json(canSeeEnv ? data : redactContainerEnv(data));
  } catch (err) {
    const message = formatError(err);
    if (dockerErrorStatus(err) !== 400) updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: dockerErrorStatus(err) });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: Action };
  if (!body.action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }
  try {
    await containerAction(record.config as DockerConfig, cid, body.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: dockerErrorStatus(err) });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    await containerAction(record.config as DockerConfig, cid, "remove");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: dockerErrorStatus(err) });
  }
}
