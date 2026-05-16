import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listChromaCollections } from "@/lib/connections/chroma";
import type { ChromaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "chroma") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const collections = await listChromaCollections(
      record.config as ChromaConfig
    );
    updateStatus(id, "ok");
    return NextResponse.json({ collections });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
