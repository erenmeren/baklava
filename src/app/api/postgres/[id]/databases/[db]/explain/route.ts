import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { explainQuery } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

interface Body {
  sql?: string;
  analyze?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.sql || !body.sql.trim()) {
    return NextResponse.json({ error: "sql is required" }, { status: 400 });
  }
  try {
    const result = await explainQuery(
      record.config as PostgresConfig,
      decodeURIComponent(db),
      body.sql,
      { analyze: body.analyze ?? true },
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
