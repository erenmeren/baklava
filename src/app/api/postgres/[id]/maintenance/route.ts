import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  reindexTable,
  runMaintenance,
  type MaintenanceMode,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type Body = {
  database?: string;
  schema?: string;
  table?: string;
  action?: MaintenanceMode | "reindex";
};

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.database || !body.schema || !body.table || !body.action) {
    return NextResponse.json(
      { error: "database, schema, table, action are required" },
      { status: 400 }
    );
  }
  try {
    if (body.action === "reindex") {
      await reindexTable(
        record.config as PostgresConfig,
        body.database,
        body.schema,
        body.table
      );
    } else {
      await runMaintenance(
        record.config as PostgresConfig,
        body.database,
        body.schema,
        body.table,
        body.action
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
