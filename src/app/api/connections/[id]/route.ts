import { NextResponse } from "next/server";
import {
  deleteConnection,
  getConnection,
  publicView,
  updateConnection,
} from "@/lib/connections/store";
import { dropConnectionSessions } from "@/lib/connections/terminal-sessions";
import { dropKubernetesClient } from "@/lib/connections/kubernetes";
import { dropConnectionExecSessions } from "@/lib/connections/kubernetes-sessions";
import { dropRedisClient } from "@/lib/connections/redis";
import { dropMongoClient } from "@/lib/connections/mongo";
import { dropR2Client } from "@/lib/connections/r2";
import { dropMinioClient } from "@/lib/connections/minio";
import { dropS3Client } from "@/lib/connections/s3-aws";
import { dropPostgresPools } from "@/lib/connections/postgres";
import { dropConnectionGrants, effectiveAccess } from "@/lib/connections/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deletePolicy } from "@/lib/ai/policy-store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Belt-and-suspenders RBAC: the proxy already guards connection-scoped paths,
 * but the route must also be correct in isolation. Returns the effective access
 * level for the current user, or null if the request is unauthenticated.
 */
function accessFor(
  req: Request,
  conn: { id: string; ownerId?: string }
): "none" | "read" | "write" | null {
  const user = getCurrentUser(req);
  if (!user) return null;
  return effectiveAccess({
    user: { id: user.id, role: user.role },
    conn: { id: conn.id, ownerId: conn.ownerId },
  });
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  // Hide existence from users who can't access this connection.
  if (accessFor(req, record) === "none") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  return NextResponse.json(publicView(record));
}

interface PatchBody {
  name?: string;
  config?: Record<string, unknown>;
  /** Config keys to remove (e.g. clearing an optional sessionToken). */
  unset?: string[];
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = getConnection(id);
  if (!existing) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  // Editing a connection requires write (owner/admin or a write grant).
  if (accessFor(req, existing) !== "write") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    body.name === undefined &&
    (body.config === undefined || Object.keys(body.config).length === 0) &&
    !body.unset?.length
  ) {
    return NextResponse.json(
      { error: "Nothing to update — provide name or config" },
      { status: 400 }
    );
  }
  const updated = updateConnection(id, body);
  if (!updated) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  return NextResponse.json(publicView(updated));
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  // Deleting a connection requires write (owner/admin or a write grant).
  if (accessFor(req, record) !== "write") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ok = deleteConnection(id);
  if (!ok) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  dropConnectionSessions(id);
  dropConnectionExecSessions(id);
  dropKubernetesClient(id);
  dropRedisClient(id);
  dropMongoClient(id);
  dropR2Client(id);
  dropMinioClient(id);
  dropS3Client(id);
  if (record?.tech === "postgres") {
    dropPostgresPools(record.config as import("@/lib/connections/types").PostgresConfig);
  }
  deletePolicy(id);
  dropConnectionGrants(id);
  return NextResponse.json({ ok: true });
}
