import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { maintainSqlServerIndex } from "@/lib/connections/sqlserver";
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
  const cfg = record.config as SqlServerConfig;
  const body = (await req.json().catch(() => ({}))) as {
    db?: string;
    schema?: string;
    table?: string;
    index?: string;
    action?: "rebuild" | "reorganize";
  };
  if (!body.schema || !body.table || !body.index || !body.action) {
    return NextResponse.json(
      { error: "schema, table, index, action required" },
      { status: 400 },
    );
  }
  try {
    await maintainSqlServerIndex(
      cfg,
      body.db || cfg.database,
      body.schema,
      body.table,
      body.index,
      body.action,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
