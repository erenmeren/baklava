import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listIndexes, createIndex } from "@/lib/connections/mysql";
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

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const indexes = await listIndexes(r.cfg, r.db, r.table);
    return NextResponse.json({ indexes });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface CreateBody {
  name?: string;
  columns?: string[];
  unique?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.name || !body.columns?.length) {
    return NextResponse.json(
      { error: "name and columns are required" },
      { status: 400 }
    );
  }
  try {
    await createIndex(r.cfg, r.db, r.table, {
      name: body.name,
      columns: body.columns,
      unique: !!body.unique,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
