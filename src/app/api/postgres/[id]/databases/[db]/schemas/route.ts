import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listSchemas, createSchema } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const schemas = await listSchemas(
      record.config as PostgresConfig,
      decodeURIComponent(db)
    );
    return NextResponse.json({ schemas });
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
  let body: { name?: string; ifNotExists?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }
  try {
    await createSchema(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      body.name,
      { ifNotExists: body.ifNotExists }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
