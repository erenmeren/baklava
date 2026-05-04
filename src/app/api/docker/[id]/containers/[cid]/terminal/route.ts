import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { startTerminal } from "@/lib/connections/docker";
import { registerSession } from "@/lib/connections/terminal-sessions";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import type { Duplex } from "node:stream";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

interface StartBody {
  shell?: string;
  cols?: number;
  rows?: number;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as StartBody;
  const cols = Math.min(Math.max(Number(body.cols) || 80, 20), 400);
  const rows = Math.min(Math.max(Number(body.rows) || 24, 5), 200);
  const shell = body.shell || "/bin/sh";

  try {
    const { exec, stream } = await startTerminal(
      record.config as DockerConfig,
      cid,
      { shell, cols, rows }
    );
    const session = registerSession({
      connectionId: id,
      containerId: cid,
      exec,
      stream: stream as unknown as Duplex,
    });
    return NextResponse.json({ sessionId: session.id, shell, cols, rows });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
