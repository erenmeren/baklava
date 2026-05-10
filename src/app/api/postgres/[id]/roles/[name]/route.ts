import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { alterRole, dropRole, type RoleAttrs } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { attrs?: RoleAttrs };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.attrs || Object.keys(body.attrs).length === 0) {
    return NextResponse.json(
      { error: "attrs is required" },
      { status: 400 },
    );
  }
  try {
    await alterRole(
      record.config as PostgresConfig,
      decodeURIComponent(name),
      body.attrs,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    await dropRole(record.config as PostgresConfig, decodeURIComponent(name), {
      ifExists: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
