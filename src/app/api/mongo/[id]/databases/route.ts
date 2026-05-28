import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listDatabases } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const databases = await listDatabases(id, record.config as MongoConfig);
    updateStatus(id, "ok");
    return NextResponse.json({ databases });
  } catch (err) {
    const msg = formatError(err);
    updateStatus(id, "error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
