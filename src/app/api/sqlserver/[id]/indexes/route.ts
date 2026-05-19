import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  getSqlServerIndexFragmentation,
  getSqlServerMissingIndexes,
} from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as SqlServerConfig;
  const db = req.nextUrl.searchParams.get("db") || cfg.database;
  try {
    const [fragmentation, missing] = await Promise.all([
      getSqlServerIndexFragmentation(cfg, db),
      getSqlServerMissingIndexes(cfg, db),
    ]);
    return NextResponse.json({ database: db, fragmentation, missing });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
