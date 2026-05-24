import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { executeSqlServerDdl } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

/**
 * Run a single CREATE batch (view / proc / function / trigger). The dialog
 * client trusts the user-edited SQL exactly like the query editor does — this
 * route is the "Script CREATE To" submit target.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: { sql?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await executeSqlServerDdl(
      record.config as SqlServerConfig,
      decodeURIComponent(db),
      body.sql ?? "",
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
