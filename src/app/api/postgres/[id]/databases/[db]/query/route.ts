import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { runQuery } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

interface QueryRequest {
  sql: string;
}

const MAX_ROWS = 500;

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: QueryRequest;
  try {
    body = (await req.json()) as QueryRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.sql?.trim()) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }

  try {
    const result = await runQuery(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      body.sql
    );
    updateStatus(id, "ok");
    const truncated = result.rows.slice(0, MAX_ROWS);
    return NextResponse.json({
      fields: result.fields,
      rows: truncated,
      rowCount: result.rowCount,
      truncated: result.rows.length > truncated.length,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
