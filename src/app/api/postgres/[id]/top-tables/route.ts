import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getTopTablesAllDatabases } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Server-wide top tables across every non-template database.
 * Useful on the connection overview — answers "where's the data on this
 * server?" without forcing the user to walk each DB by hand.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") || "10"), 1),
    50,
  );
  try {
    const tables = await getTopTablesAllDatabases(
      record.config as PostgresConfig,
      limit,
    );
    return NextResponse.json({ tables });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
