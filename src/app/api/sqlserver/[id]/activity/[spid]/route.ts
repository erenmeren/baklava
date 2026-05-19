import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { killSqlServerSession } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; spid: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id, spid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const n = Number(spid);
  try {
    await killSqlServerSession(record.config as SqlServerConfig, n);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
