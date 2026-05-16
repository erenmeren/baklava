import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  sampleChromaCollection,
  getChromaSampleDetail,
} from "@/lib/connections/chroma";
import type { ChromaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "chroma") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const detailId = req.nextUrl.searchParams.get("id");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 50;
  try {
    // ?id=… returns ONE record with full vector head/tail for the drawer.
    if (detailId) {
      const item = await getChromaSampleDetail(
        record.config as ChromaConfig,
        decodeURIComponent(name),
        detailId
      );
      return NextResponse.json({ item });
    }
    const result = await sampleChromaCollection(
      record.config as ChromaConfig,
      decodeURIComponent(name),
      Number.isFinite(limit) ? limit : 50
    );
    return NextResponse.json({ items: result.items, note: result.note });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
