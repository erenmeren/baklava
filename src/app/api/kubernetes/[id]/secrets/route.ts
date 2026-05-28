import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listSecrets } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

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
  const ns = req.nextUrl.searchParams.get("namespace") || undefined;
  try {
    const rows = await listSecrets(id, record.config as KubernetesConfig, ns);
    updateStatus(id, "ok");
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = formatError(err);
    updateStatus(id, "error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
