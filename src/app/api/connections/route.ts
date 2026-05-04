import { NextRequest, NextResponse } from "next/server";
import { listConnections, publicView } from "@/lib/connections/store";
import type { TechId } from "@/lib/connections/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const tech = req.nextUrl.searchParams.get("tech") as TechId | null;
  const records = listConnections(tech ?? undefined);
  return NextResponse.json({ connections: records.map(publicView) });
}
