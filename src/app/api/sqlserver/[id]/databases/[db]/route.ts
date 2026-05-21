import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { dropSqlServerDatabase } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const force = req.nextUrl.searchParams.get("force") === "true";
  try {
    await dropSqlServerDatabase(record.config as SqlServerConfig, decodeURIComponent(db), {
      force,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
