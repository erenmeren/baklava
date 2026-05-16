import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getCollectionDetail } from "@/lib/connections/weaviate";
import type { WeaviateConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "weaviate") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  try {
    const collection = await getCollectionDetail(
      record.config as WeaviateConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ collection });
  } catch (err) {
    return NextResponse.json(
      { error: formatError(err) },
      { status: 502 }
    );
  }
}
