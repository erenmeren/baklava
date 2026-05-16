import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { sampleCollection } from "@/lib/connections/qdrant";
import type { QdrantConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "qdrant") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  // Hard cap at 100 to prevent users (or scripts) from pulling huge payloads.
  const limitParam = Number(req.nextUrl.searchParams.get("limit") || 50);
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitParam) ? limitParam : 50),
    100
  );
  const withVector = req.nextUrl.searchParams.get("withVector") === "1";
  try {
    const items = await sampleCollection(
      record.config as QdrantConfig,
      decodeURIComponent(name),
      { limit, withVector }
    );
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: formatError(err) },
      { status: 502 }
    );
  }
}
