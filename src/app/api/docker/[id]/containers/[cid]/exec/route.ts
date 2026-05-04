import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { execInContainer } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

interface ExecRequest {
  command: string;
  shell?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: ExecRequest;
  try {
    body = (await req.json()) as ExecRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.command?.trim()) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }
  const shell = body.shell || "/bin/sh";
  const cmd = [shell, "-c", body.command];
  try {
    const result = await execInContainer(
      record.config as DockerConfig,
      cid,
      cmd
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
