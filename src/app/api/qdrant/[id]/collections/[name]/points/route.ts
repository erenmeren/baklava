import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { scrollPoints, deletePoints } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; name: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 25), 100);
  const offsetRaw = sp.get("offset");
  // offset arrives as a string; coerce digit-only values back to a number so
  // integer point-id collections accept the continuation cursor.
  const offset =
    offsetRaw == null || offsetRaw === ""
      ? undefined
      : /^\d+$/.test(offsetRaw)
        ? Number(offsetRaw)
        : offsetRaw;
  const withVector = sp.get("withVector") === "1";
  try {
    const res = await scrollPoints(record.config, decodeURIComponent(name), { limit, offset, withVector });
    return NextResponse.json(res);
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const body = (await req.json()) as { ids?: (string | number)[] };
  if (!body.ids?.length) return NextResponse.json({ error: "ids are required" }, { status: 400 });
  try { await deletePoints(record.config, decodeURIComponent(name), body.ids); return NextResponse.json({ ok: true }); }
  catch (err) { return errorResponse(err); }
}
