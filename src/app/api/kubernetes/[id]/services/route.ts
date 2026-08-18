import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listServices } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { resolveNamespace } from "@/lib/kubernetes/namespace";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as KubernetesConfig;
  // No `?namespace=` falls back to the connection's configured namespace — a
  // namespace-scoped kubeconfig can't list cluster-wide.
  const ns = resolveNamespace(
    req.nextUrl.searchParams.get("namespace") ?? undefined,
    cfg.namespace,
  );
  try {
    const rows = await listServices(id, cfg, ns);
    updateStatus(id, "ok");
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = formatError(err);
    updateStatus(id, "error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
