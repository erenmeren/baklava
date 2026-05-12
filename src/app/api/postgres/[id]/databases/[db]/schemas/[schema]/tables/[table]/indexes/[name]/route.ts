import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { dropIndex, renameIndex } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    id: string;
    db: string;
    schema: string;
    table: string;
    name: string;
  }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { newName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.newName) {
    return NextResponse.json(
      { error: "newName is required" },
      { status: 400 },
    );
  }
  try {
    await renameIndex(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
      body.newName,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cascade = req.nextUrl.searchParams.get("cascade") === "true";
  try {
    await dropIndex(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
      { cascade, ifExists: true },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
