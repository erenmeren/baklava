import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import {
  listColumns,
  listIndexes,
  getTableDDL,
  dropTable,
  truncateTable,
} from "@/lib/connections/mysql";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; table: string }>;
}

async function resolve(ctx: RouteContext) {
  const { id, db, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return {
      error: NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      ),
    };
  }
  return {
    id,
    cfg: record.config as MysqlConfig,
    db: decodeURIComponent(db),
    table: decodeURIComponent(table),
  };
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const [columns, indexes, ddl] = await Promise.all([
      listColumns(r.cfg, r.db, r.table),
      listIndexes(r.cfg, r.db, r.table),
      getTableDDL(r.cfg, r.db, r.table),
    ]);
    updateStatus(r.id, "ok");
    return NextResponse.json({
      columns,
      indexes,
      ddl,
      primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  const action = req.nextUrl.searchParams.get("action");
  const kind = req.nextUrl.searchParams.get("kind") === "view" ? "view" : "table";
  try {
    if (action === "truncate") {
      await truncateTable(r.cfg, r.db, r.table);
    } else {
      await dropTable(r.cfg, r.db, r.table, kind);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
