import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { setQueryStorePlanForced } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    db?: string;
    queryId?: number;
    planId?: number;
    forced?: boolean;
  };
  const cfg = record.config as SqlServerConfig;
  if (typeof body.queryId !== "number" || typeof body.planId !== "number") {
    return NextResponse.json({ error: "queryId and planId required" }, { status: 400 });
  }
  try {
    await setQueryStorePlanForced(
      cfg,
      body.db || cfg.database,
      body.queryId,
      body.planId,
      Boolean(body.forced),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
