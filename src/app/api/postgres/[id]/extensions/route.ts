import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  listExtensions,
  createExtension,
  dropExtension,
  updateExtension,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/postgres/[id]/extensions?db=<name>
 *
 * Lists installed + available extensions for the given database. Defaults
 * to the connection's default database when `db` is omitted.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as PostgresConfig;
  const db = req.nextUrl.searchParams.get("db") || cfg.database;
  try {
    const data = await listExtensions(cfg, db);
    return NextResponse.json({ database: db, ...data });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

/**
 * POST /api/postgres/[id]/extensions
 * Body: { action: "create"|"drop"|"update", name, db?, cascade?, schema? }
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as PostgresConfig;
  let body: {
    action?: string;
    name?: string;
    db?: string;
    cascade?: boolean;
    schema?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.action || !body.name) {
    return NextResponse.json(
      { error: "action and name are required" },
      { status: 400 },
    );
  }
  const db = body.db || cfg.database;
  try {
    switch (body.action) {
      case "create":
        await createExtension(cfg, db, body.name, {
          cascade: body.cascade,
          schema: body.schema,
        });
        break;
      case "drop":
        await dropExtension(cfg, db, body.name, { cascade: body.cascade });
        break;
      case "update":
        await updateExtension(cfg, db, body.name);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 },
        );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
