import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { describeChromaCollection } from "@/lib/connections/chroma";
import type { ChromaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "chroma") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const collection = await describeChromaCollection(
      record.config as ChromaConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ collection });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
