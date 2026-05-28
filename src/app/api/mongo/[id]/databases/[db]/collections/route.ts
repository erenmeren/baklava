import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { createCollectionOp, listCollections } from "@/lib/connections/mongo";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const collections = await listCollections(
      id,
      record.config as MongoConfig,
      decodeURIComponent(db),
    );
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface CreateBody {
  name: string;
  capped?: boolean;
  size?: number;
  max?: number;
  validatorEjson?: string;
  validationLevel?: "off" | "strict" | "moderate";
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mongo") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    await createCollectionOp(
      id,
      record.config as MongoConfig,
      decodeURIComponent(db),
      body,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
