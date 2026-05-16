import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { sampleMilvusCollection } from "@/lib/connections/milvus";
import type { MilvusConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "milvus") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 50;
  try {
    const result = await sampleMilvusCollection(
      record.config as MilvusConfig,
      decodeURIComponent(name),
      Number.isFinite(limit) ? limit : 50
    );
    return NextResponse.json({
      items: result.rows,
      note: result.note,
      notLoaded: result.notLoaded,
    });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
