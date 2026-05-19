import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { runSqlServerScript } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  sql?: string;
  database?: string;
  statistics?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.sql?.trim()) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }
  try {
    const result = await runSqlServerScript(
      record.config as SqlServerConfig,
      body.database,
      body.sql,
      { statistics: body.statistics },
    );
    return NextResponse.json(result);
  } catch (err) {
    // Connection-level failures only — per-batch errors live in result.batches.
    return NextResponse.json({ error: formatError(err) }, { status: 200 });
  }
}
