import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { runQuery, runQueryMulti } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

interface QueryRequest {
  sql: string;
  /** When true, run as multiple statements and return one result per. */
  multi?: boolean;
  /** Optional schema to SET search_path TO before running (per-run, scoped to
   *  the fresh client connection so it doesn't leak). */
  searchPath?: string;
}

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

  // Multi-statement mode: never throws — failures land in `results[i].error`.
  if (body.multi) {
    try {
      const result = await runQueryMulti(
        record.config as PostgresConfig,
        decodeURIComponent(db),
        body.sql,
        { searchPath: body.searchPath },
      );
      updateStatus(id, "ok");
      return NextResponse.json({
        // The driver caps rows via a server-side cursor and sets `truncated`.
        results: result.results.map((r) => {
          if ("error" in r) return r;
          return {
            sql: r.sql,
            fields: r.fields,
            rows: r.rows,
            rowCount: r.rowCount,
            truncated: r.truncated ?? false,
            durationMs: r.durationMs,
            isCommand: r.isCommand,
            command: r.command,
          };
        }),
        totalDurationMs: result.totalDurationMs,
      });
    } catch (err) {
      return NextResponse.json(
        { error: formatError(err) },
        { status: 200 },
      );
    }
  }

  try {
    const result = await runQuery(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      body.sql
    );
    updateStatus(id, "ok");
    return NextResponse.json({
      fields: result.fields,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated ?? false,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
