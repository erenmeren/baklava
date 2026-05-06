import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  createTable,
  type CreateTableColumnInput,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string }>;
}

interface CreateTableBody {
  name?: string;
  columns?: CreateTableColumnInput[];
  ifNotExists?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: CreateTableBody;
  try {
    body = (await req.json()) as CreateTableBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await createTable(record.config as PostgresConfig, decodeURIComponent(db), {
      schema: decodeURIComponent(schema),
      name: body.name ?? "",
      columns: body.columns ?? [],
      ifNotExists: body.ifNotExists,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
