import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { getSqliteOverview } from "@/lib/connections/sqlite";
import type { SqliteConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "sqlite") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const overview = await getSqliteOverview(record.config as SqliteConfig);
    updateStatus(id, "ok");
    return NextResponse.json(overview);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
