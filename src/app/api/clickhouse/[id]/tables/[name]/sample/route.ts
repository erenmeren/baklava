import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { sampleClickhouseTable } from "@/lib/connections/clickhouse";
import type { ClickhouseConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "clickhouse") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 100;
  try {
    const result = await sampleClickhouseTable(
      record.config as ClickhouseConfig,
      decodeURIComponent(name),
      limit
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
