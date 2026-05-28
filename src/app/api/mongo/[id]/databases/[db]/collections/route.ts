import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listCollections } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const collections = await listCollections(
      id,
      record.config as MongoConfig,
      decodeURIComponent(db),
    );
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
