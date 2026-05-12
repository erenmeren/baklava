import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { createIndex, type CreateIndexInput } from "@/lib/connections/postgres";
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

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { input?: CreateIndexInput };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.input || !Array.isArray(body.input.columns) || body.input.columns.length === 0) {
    return NextResponse.json(
      { error: "input.columns is required" },
      { status: 400 },
    );
  }
  try {
    await createIndex(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(table),
      body.input,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
