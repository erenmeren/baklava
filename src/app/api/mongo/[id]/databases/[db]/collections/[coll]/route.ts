import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { dropCollectionOp } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; coll: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, db, coll } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    await dropCollectionOp(
      id,
      record.config as MongoConfig,
      decodeURIComponent(db),
      decodeURIComponent(coll),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
