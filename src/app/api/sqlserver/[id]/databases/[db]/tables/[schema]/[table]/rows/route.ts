import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  deleteSqlServerRow,
  insertSqlServerRow,
  updateSqlServerRow,
  type SqlServerColumnValue,
  type SqlServerPrimaryKeyValue,
} from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    id: string;
    db: string;
    schema: string;
    table: string;
  }>;
}

interface InsertBody {
  values: Record<string, SqlServerColumnValue>;
}

interface UpdateBody {
  pk: SqlServerPrimaryKeyValue[];
  values: Record<string, SqlServerColumnValue>;
}

interface DeleteBody {
  pk: SqlServerPrimaryKeyValue[];
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

export async function POST(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const body = (await req.json()) as InsertBody;
    const result = await insertSqlServerRow(
      r.cfg,
      r.db,
      r.schema,
      r.table,
      body.values || {},
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const body = (await req.json()) as UpdateBody;
    const result = await updateSqlServerRow(
      r.cfg,
      r.db,
      r.schema,
      r.table,
      body.pk || [],
      body.values || {},
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const body = (await req.json()) as DeleteBody;
    const result = await deleteSqlServerRow(
      r.cfg,
      r.db,
      r.schema,
      r.table,
      body.pk || [],
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
