import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { getMilvusSummary } from "@/lib/connections/milvus";
import type { MilvusConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "milvus") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const summary = await getMilvusSummary(record.config as MilvusConfig);
    updateStatus(id, "ok");
    return NextResponse.json(summary);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
