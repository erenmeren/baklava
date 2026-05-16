import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { getPod } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; namespace: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, namespace, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const pod = await getPod(
      record.config as KubernetesConfig,
      decodeURIComponent(namespace),
      decodeURIComponent(name)
    );
    updateStatus(id, "ok");
    return NextResponse.json(pod);
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
