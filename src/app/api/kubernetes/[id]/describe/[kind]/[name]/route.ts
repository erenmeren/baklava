import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { describeResource } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; kind: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, kind, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const ns = req.nextUrl.searchParams.get("namespace") || undefined;
  try {
    const text = await describeResource(
      id,
      record.config as KubernetesConfig,
      kind,
      ns,
      name,
    );
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
