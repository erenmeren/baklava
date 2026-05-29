import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listDatabases, createDatabase } from "@/lib/connections/mysql";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const databases = await listDatabases(record.config as MysqlConfig);
    updateStatus(id, "ok");
    return NextResponse.json({ databases });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { name?: string; charset?: string; collation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    await createDatabase(record.config as MysqlConfig, body.name, {
      charset: body.charset,
      collation: body.collation,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
