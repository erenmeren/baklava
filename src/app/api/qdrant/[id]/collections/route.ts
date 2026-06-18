import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { listCollections, createCollection } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  try { return NextResponse.json({ collections: await listCollections(record.config) }); }
  catch (err) { return errorResponse(err); }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const body = (await req.json()) as { name?: string; size?: number; distance?: string };
  if (!body.name || !body.size || !body.distance) {
    return NextResponse.json({ error: "name, size and distance are required" }, { status: 400 });
  }
  try { await createCollection(record.config, body.name, { size: body.size, distance: body.distance }); return NextResponse.json({ ok: true }); }
  catch (err) { return errorResponse(err); }
}
