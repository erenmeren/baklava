import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getPodLogs } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; namespace: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, namespace, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const container = req.nextUrl.searchParams.get("container") || undefined;
  const tail = Math.min(
    5000,
    Math.max(10, Number(req.nextUrl.searchParams.get("tail") ?? "500"))
  );
  const previous = req.nextUrl.searchParams.get("previous") === "1";
  try {
    const logs = await getPodLogs(
      record.config as KubernetesConfig,
      decodeURIComponent(namespace),
      decodeURIComponent(name),
      { container, tailLines: tail, previous }
    );
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
