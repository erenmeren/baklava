import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import {
  listTables,
  createTable,
  type CreateTableColumnInput,
} from "@/lib/connections/mysql";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const tables = await listTables(
      record.config as MysqlConfig,
      decodeURIComponent(db)
    );
    updateStatus(id, "ok");
    return NextResponse.json({ tables });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface CreateBody {
  name?: string;
  columns?: CreateTableColumnInput[];
  engine?: string;
  comment?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.name || !body.columns?.length) {
    return NextResponse.json(
      { error: "name and at least one column are required" },
      { status: 400 }
    );
  }
  try {
    await createTable(record.config as MysqlConfig, decodeURIComponent(db), {
      name: body.name,
      columns: body.columns,
      engine: body.engine,
      comment: body.comment,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
