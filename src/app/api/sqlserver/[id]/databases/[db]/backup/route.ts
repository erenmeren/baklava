import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  getSqlServerBackupHistory,
  backupSqlServerDatabase,
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
    const history = await getSqlServerBackupHistory(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
    );
    return NextResponse.json({ history });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { path?: string };
  if (!body.path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    await backupSqlServerDatabase(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
      body.path,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
