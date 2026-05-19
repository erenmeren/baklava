import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { streamDatabaseDump, restoreSql } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { NextResponse } from "next/server";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

/**
 * GET — streams a SQL dump of the database as a downloadable .sql file.
 * Query params:
 *   schemas=public,app   (optional, comma-separated)
 *   data=0               (optional — schema-only when "0")
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return new Response("Connection not found", { status: 404 });
  }
  const database = decodeURIComponent(db);
  const schemasParam = req.nextUrl.searchParams.get("schemas");
  const schemas = schemasParam
    ? schemasParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const includeData = req.nextUrl.searchParams.get("data") !== "0";

  const encoder = new TextEncoder();
  const gen = streamDatabaseDump(record.config as PostgresConfig, database, {
    schemas,
    includeData,
  });

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`\n-- ERROR: ${formatError(err)}\n`),
        );
        controller.close();
      }
    },
    async cancel() {
      await gen.return?.(undefined);
    },
  });

  const filename = `${database}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.sql`;
  return new Response(stream, {
    headers: {
      "content-type": "application/sql; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * POST — restore by executing an uploaded SQL dump. Body is the raw SQL
 * (content-type text/plain or application/sql).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const sql = await req.text();
  if (!sql.trim()) {
    return NextResponse.json({ error: "Empty SQL body" }, { status: 400 });
  }
  try {
    const result = await restoreSql(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      sql,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
