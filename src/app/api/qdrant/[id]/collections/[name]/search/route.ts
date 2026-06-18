import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { searchPoints } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; name: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const body = (await req.json()) as { vector?: number[]; pointId?: string | number; vectorName?: string; limit?: number; filter?: unknown };
  try {
    const hits = await searchPoints(record.config, decodeURIComponent(name), {
      vector: body.vector, pointId: body.pointId, vectorName: body.vectorName,
      limit: Math.min(body.limit ?? 10, 100), filter: body.filter,
    });
    return NextResponse.json({ hits });
  } catch (err) { return errorResponse(err); }
}
