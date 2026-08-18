import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  readResourceYaml,
  replaceResourceYaml,
  deleteResource,
} from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { effectiveAccess } from "@/lib/connections/access";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

interface RouteContext {
  // For cluster-scoped kinds (namespaces) the ns query param is absent;
  // for namespaced kinds the route reads `?namespace=…`.
  params: Promise<{ id: string; kind: string; name: string }>;
}

/**
 * A Secret's manifest carries its values, so reading one is a privilege of its
 * own — the AI gate already treats it that way (`policy.allowK8sSecretValues`,
 * default off). A `read` grant gets the Secret's shape; the values need write.
 * `replaceResourceYaml` refuses to apply a values-less Secret, so the redacted
 * buffer can never wipe one by round-tripping.
 */
function canSeeSecretValues(req: NextRequest, conn: { id: string; ownerId?: string }): boolean {
  const user = getCurrentUser(req);
  if (!user) return false;
  return (
    effectiveAccess({
      user: { id: user.id, role: user.role },
      conn: { id: conn.id, ownerId: conn.ownerId },
    }) === "write"
  );
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, kind, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const ns = req.nextUrl.searchParams.get("namespace") || undefined;
  // Only Secrets carry values worth gating — don't resolve the session on
  // every manifest read.
  const redactSecretValues =
    kind.toLowerCase() === "secret" && !canSeeSecretValues(req, record);
  try {
    const yaml = await readResourceYaml(
      id,
      record.config as KubernetesConfig,
      kind,
      ns,
      name,
      { redactSecretValues },
    );
    return NextResponse.json({ yaml });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface PutBody {
  yaml: string;
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.yaml?.trim()) {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }
  try {
    await replaceResourceYaml(id, record.config as KubernetesConfig, body.yaml);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, kind, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const ns = req.nextUrl.searchParams.get("namespace") || undefined;
  try {
    await deleteResource(id, record.config as KubernetesConfig, kind, ns, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
