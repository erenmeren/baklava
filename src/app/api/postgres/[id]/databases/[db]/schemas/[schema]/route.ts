import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { dropSchema } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string }>;
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cascade = req.nextUrl.searchParams.get("cascade") === "true";
  try {
    await dropSchema(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      { cascade, ifExists: true }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
