import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { getCollection, deleteCollection } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; name: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  try { return NextResponse.json(await getCollection(record.config, decodeURIComponent(name))); }
  catch (err) { return errorResponse(err); }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  try { await deleteCollection(record.config, decodeURIComponent(name)); return NextResponse.json({ ok: true }); }
  catch (err) { return errorResponse(err); }
}
