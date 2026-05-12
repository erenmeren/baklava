import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { dropView, getViewDefinition } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const definition = await getViewDefinition(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
    );
    return NextResponse.json({ definition });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cascade = req.nextUrl.searchParams.get("cascade") === "true";
  const materialized =
    req.nextUrl.searchParams.get("materialized") === "true";
  try {
    await dropView(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
      { cascade, ifExists: true, materialized },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
