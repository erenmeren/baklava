import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { getTopTables } from "@/lib/connections/mysql";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 10);
  try {
    const tables = await getTopTables(
      record.config as MysqlConfig,
      Number.isFinite(limit) ? limit : 10
    );
    updateStatus(id, "ok");
    return NextResponse.json({ tables });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
