import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  readTableData,
  insertRow,
  updateRow,
  deleteRow,
  type ColumnValue,
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
    cfg: record.config as MysqlConfig,
    db: decodeURIComponent(db),
    table: decodeURIComponent(table),
  };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  const sp = req.nextUrl.searchParams;
  try {
    const data = await readTableData(r.cfg, r.db, r.table, {
      limit: Number(sp.get("limit") ?? 100),
      offset: Number(sp.get("offset") ?? 0),
      orderBy: sp.get("orderBy") ?? undefined,
      orderDir: sp.get("orderDir") === "desc" ? "desc" : "asc",
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface InsertBody {
  values: Record<string, ColumnValue>;
}
interface UpdateBody {
  pk: Record<string, ColumnValue>;
  values: Record<string, ColumnValue>;
}
interface DeleteBody {
  pk: Record<string, ColumnValue>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const body = (await req.json()) as InsertBody;
    await insertRow(r.cfg, r.db, r.table, body.values || {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const body = (await req.json()) as UpdateBody;
    await updateRow(r.cfg, r.db, r.table, body.pk || {}, body.values || {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const body = (await req.json()) as DeleteBody;
    await deleteRow(r.cfg, r.db, r.table, body.pk || {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
