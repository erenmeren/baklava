import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  listFunctions,
  createOrReplaceFunction,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db, schema } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const functions = await listFunctions(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema)
    );
    return NextResponse.json({ functions });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { sql?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.sql || !body.sql.trim()) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }
  try {
    await createOrReplaceFunction(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      body.sql,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
