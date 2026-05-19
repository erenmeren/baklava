import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getSqlServerEstimatedPlan } from "@/lib/connections/sqlserver";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlserver") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    sql?: string;
    database?: string;
  };
  if (!body.sql?.trim()) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }
  try {
    const plan = await getSqlServerEstimatedPlan(
      record.config as SqlServerConfig,
      body.database,
      body.sql,
    );
    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 200 });
  }
}
