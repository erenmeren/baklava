import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  listColumns,
  listConstraints,
  listForeignKeys,
  listIndexes,
  readTableData,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
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

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const view = req.nextUrl.searchParams.get("view") || "structure";
  const cfg = record.config as PostgresConfig;
  const dbName = decodeURIComponent(db);
  const schemaName = decodeURIComponent(schema);
  const tableName = decodeURIComponent(table);
  try {
    switch (view) {
      case "structure":
        return NextResponse.json({
          columns: await listColumns(cfg, dbName, schemaName, tableName),
        });
      case "indexes":
        return NextResponse.json({
          indexes: await listIndexes(cfg, dbName, schemaName, tableName),
        });
      case "constraints":
        return NextResponse.json({
          constraints: await listConstraints(cfg, dbName, schemaName, tableName),
        });
      case "foreign_keys":
        return NextResponse.json({
          foreignKeys: await listForeignKeys(cfg, dbName, schemaName, tableName),
        });
      case "data": {
        const limit = Math.min(
          Math.max(Number(req.nextUrl.searchParams.get("limit") || "100"), 1),
          1000
        );
        const offset = Math.max(
          Number(req.nextUrl.searchParams.get("offset") || "0"),
          0
        );
        return NextResponse.json(
          await readTableData(cfg, dbName, schemaName, tableName, limit, offset)
        );
      }
      default:
        return NextResponse.json(
          { error: "Unknown view" },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
