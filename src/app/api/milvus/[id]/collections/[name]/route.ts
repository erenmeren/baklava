import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { describeMilvusCollection } from "@/lib/connections/milvus";
import type { MilvusConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "milvus") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const collection = await describeMilvusCollection(
      record.config as MilvusConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ collection });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
