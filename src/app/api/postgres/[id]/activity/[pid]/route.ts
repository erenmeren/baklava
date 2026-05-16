import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { cancelBackend, terminateBackend } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; pid: string }>;
}

type Action = "cancel" | "terminate";

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, pid: pidStr } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const pid = Number(pidStr);
  if (!Number.isInteger(pid) || pid <= 0) {
    return NextResponse.json({ error: "Invalid PID" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: Action };
  if (body.action !== "cancel" && body.action !== "terminate") {
    return NextResponse.json(
      { error: "action must be 'cancel' or 'terminate'" },
      { status: 400 }
    );
  }
  try {
    const ok =
      body.action === "cancel"
        ? await cancelBackend(record.config as PostgresConfig, pid)
        : await terminateBackend(record.config as PostgresConfig, pid);
    return NextResponse.json({ ok });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
