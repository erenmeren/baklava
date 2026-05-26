import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  alterSqlServerTable,
  getSqlServerTableDetail,
  type SqlServerAlterTableOp,
} from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string; table: string }>;
}

async function resolve(ctx: RouteContext) {
  const { id, db, schema, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return {
      error: NextResponse.json({ error: "Connection not found" }, { status: 404 }),
    };
  }
  return {
    cfg: record.config as SqlServerConfig,
    db: decodeURIComponent(db),
    schema: decodeURIComponent(schema),
    table: decodeURIComponent(table),
  };
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const detail = await getSqlServerTableDetail(r.cfg, r.db, r.schema, r.table);
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  let body: { ops?: SqlServerAlterTableOp[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await alterSqlServerTable(
      r.cfg,
      r.db,
      r.schema,
      r.table,
      body.ops ?? [],
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
