import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { runQueryMulti, explainQuery } from "@/lib/connections/mysql";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

interface QueryRequest {
  sql: string;
  explain?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
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

  const cfg = record.config as MysqlConfig;
  // A blank :db segment means "server-level" (no default database selected).
  const database = db && db !== "_" ? decodeURIComponent(db) : undefined;

  if (body.explain) {
    try {
      const result = await explainQuery(cfg, database, body.sql);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 200 });
    }
  }

  try {
    const result = await runQueryMulti(cfg, database, body.sql);
    updateStatus(id, "ok");
    return NextResponse.json({
      // The driver caps rows via streaming + early stop and sets `truncated`.
      results: result.results.map((r) => ({
        statement: r.statement,
        columns: r.columns,
        rows: r.rows,
        rowCount: r.rowCount,
        truncated: r.truncated ?? false,
        durationMs: r.durationMs,
        command: r.command,
        isCommand: r.columns.length === 0,
      })),
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 200 });
  }
}
