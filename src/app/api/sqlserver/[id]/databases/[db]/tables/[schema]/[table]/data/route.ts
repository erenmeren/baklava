import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getSqlServerTableData } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string; table: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const offset = Number(req.nextUrl.searchParams.get("offset") || "0") || 0;
  const limit = Number(req.nextUrl.searchParams.get("limit") || "100") || 100;
  try {
    const data = await getSqlServerTableData(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(table),
      { offset, limit },
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
