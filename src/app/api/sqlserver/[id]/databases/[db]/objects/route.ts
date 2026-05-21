import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  listSqlServerObjects,
  dropSqlServerObject,
} from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const objects = await listSqlServerObjects(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
    );
    return NextResponse.json({ objects });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const sp = req.nextUrl.searchParams;
  const schema = sp.get("schema");
  const name = sp.get("name");
  const kind = sp.get("kind");
  if (!schema || !name || !kind) {
    return NextResponse.json(
      { error: "schema, name and kind are required" },
      { status: 400 },
    );
  }
  try {
    await dropSqlServerObject(record.config as SqlServerConfig, decodeURIComponent(db), {
      schema,
      name,
      kind,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
