import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { currentOps, killOp } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const includeIdle =
    req.nextUrl.searchParams.get("includeIdle") === "true";
  try {
    const ops = await currentOps(id, record.config as MongoConfig, {
      includeIdle,
    });
    return NextResponse.json({ ops });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const opid = req.nextUrl.searchParams.get("opid");
  if (!opid) {
    return NextResponse.json({ error: "opid is required" }, { status: 400 });
  }
  try {
    await killOp(id, record.config as MongoConfig, opid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
