import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listProcesses } from "@/lib/connections/mysql";
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
    const processes = await listProcesses(record.config as MysqlConfig);
    return NextResponse.json({ processes });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
