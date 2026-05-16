import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { describeNeo4jDatabase } from "@/lib/connections/neo4j";
import type { Neo4jConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "neo4j") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const detail = await describeNeo4jDatabase(
      record.config as Neo4jConfig,
      decodeURIComponent(db)
    );
    updateStatus(id, "ok");
    return NextResponse.json(detail);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
