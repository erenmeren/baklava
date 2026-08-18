import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { restartDeployment, scaleDeployment } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { parseReplicas } from "@/lib/kubernetes/deployment-ops";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; ns: string; name: string }>;
}

interface Body {
  action?: "scale" | "restart";
  replicas?: unknown;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const cfg = record.config as KubernetesConfig;

  if (body.action === "scale") {
    let replicas: number;
    try {
      replicas = parseReplicas(body.replicas);
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 400 });
    }
    try {
      await scaleDeployment(id, cfg, ns, name, replicas);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 502 });
    }
  }

  if (body.action === "restart") {
    try {
      await restartDeployment(id, cfg, ns, name);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 502 });
    }
  }

  return NextResponse.json(
    { error: "action must be 'scale' or 'restart'" },
    { status: 400 },
  );
}
