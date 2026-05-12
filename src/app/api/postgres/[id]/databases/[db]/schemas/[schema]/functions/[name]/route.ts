import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  dropFunction,
  getFunctionDefinition,
} from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; schema: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, db, schema, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const args = req.nextUrl.searchParams.get("args") ?? "";
  try {
    const definition = await getFunctionDefinition(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
      args,
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
  const args = req.nextUrl.searchParams.get("args") ?? "";
  const cascade = req.nextUrl.searchParams.get("cascade") === "true";
  const isProcedure =
    req.nextUrl.searchParams.get("kind") === "procedure";
  try {
    await dropFunction(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      decodeURIComponent(schema),
      decodeURIComponent(name),
      args,
      { cascade, ifExists: true, isProcedure },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
