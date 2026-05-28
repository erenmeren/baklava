import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { explainFind, type ExplainVerbosity } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; coll: string }>;
}

interface Body {
  filter?: string;
  verbosity?: ExplainVerbosity;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db, coll } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = ((await req.json().catch(() => ({}))) as Body) ?? {};
  try {
    const explanation = await explainFind(
      id,
      record.config as MongoConfig,
      decodeURIComponent(db),
      decodeURIComponent(coll),
      body.filter ?? "{}",
      body.verbosity ?? "executionStats",
    );
    return NextResponse.json({ explanation });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
