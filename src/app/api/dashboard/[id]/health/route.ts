import { NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { probeHealth } from "@/lib/connections/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conn = getConnection(id);
  if (!conn) {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }
  const snapshot = await probeHealth(conn);
  return NextResponse.json(snapshot);
}
