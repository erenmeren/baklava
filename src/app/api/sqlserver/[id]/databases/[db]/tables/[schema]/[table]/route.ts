import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getSqlServerTableDetail } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string; table: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const detail = await getSqlServerTableDetail(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(table),
    );
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
