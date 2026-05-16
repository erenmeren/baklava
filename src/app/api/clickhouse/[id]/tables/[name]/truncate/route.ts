import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { truncateClickhouseTable } from "@/lib/connections/clickhouse";
import type { ClickhouseConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "clickhouse") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  try {
    await truncateClickhouseTable(
      record.config as ClickhouseConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
