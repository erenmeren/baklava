import { NextRequest, NextResponse } from "next/server";
import { listConnectionsForUser, publicView } from "@/lib/connections/store";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { TechId } from "@/lib/connections/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // The auth proxy already gates this, but be defensive: an unauthenticated
  // request gets 401 rather than leaking every connection.
  const user = getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const tech = req.nextUrl.searchParams.get("tech") as TechId | null;
  const records = listConnectionsForUser(tech ?? undefined, {
    id: user.id,
    role: user.role,
  });
  return NextResponse.json({ connections: records.map(publicView) });
}
