import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listSqlServerTables } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  const database = decodeURIComponent(db);
  try {
    const result = await listSqlServerTables(
      record.config as SqlServerConfig,
      database
    );
    updateStatus(id, "ok");
    return NextResponse.json(result);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
