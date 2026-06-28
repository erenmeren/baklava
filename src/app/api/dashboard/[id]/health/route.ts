import { NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { probeHealth } from "@/lib/connections/health";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveAccess } from "@/lib/connections/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Belt-and-suspenders RBAC: `dashboard` is not a tech id, so the proxy's
  // connection-scoped path matcher historically did not cover this route. Gate
  // it here too (the proxy now also matches it). Hide existence on no access.
  const user = getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conn = getConnection(id);
  if (!conn) {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }
  const access = effectiveAccess({
    user: { id: user.id, role: user.role },
    conn: { id, ownerId: conn.ownerId },
  });
  if (access === "none") {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }
  const snapshot = await probeHealth(conn);
  return NextResponse.json(snapshot);
}
