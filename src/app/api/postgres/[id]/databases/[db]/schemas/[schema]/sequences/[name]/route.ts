import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  alterSequence,
  dropSequence,
  type SequenceOptions,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string; name: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { options?: SequenceOptions };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.options || Object.keys(body.options).length === 0) {
    return NextResponse.json(
      { error: "options is required" },
      { status: 400 },
    );
  }
  try {
    await alterSequence(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
      body.options,
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
    await dropSequence(
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
