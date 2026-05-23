import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listSchemaColumns } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string }>;
}

// Tables-with-columns digest for the SQL editor's autocomplete. One query
// covers the whole schema — cheaper than per-table fetches when the user
// hasn't shown intent for a specific table yet.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db, schema } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const tables = await listSchemaColumns(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
    );
    return NextResponse.json({ tables });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
