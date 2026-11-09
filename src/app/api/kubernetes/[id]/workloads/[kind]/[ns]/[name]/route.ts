import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  restartWorkload,
  scaleStatefulSet,
} from "@/lib/connections/kubernetes/workload-ops";
import type { KubernetesConfig } from "@/lib/connections/types";
import { parseReplicas } from "@/lib/kubernetes/deployment-ops";
import { parseWorkloadKind, type WorkloadKind } from "@/lib/kubernetes/workload-ops";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; kind: string; ns: string; name: string }>;
}

interface Body {
  action?: "scale" | "restart";
  replicas?: unknown;
}

/**
 * Restart (any workload kind) and scale (StatefulSet) — Deployments keep their
 * own `/deployments/<ns>/<name>` route.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, kind: rawKind, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as KubernetesConfig;
  let kind: WorkloadKind;
  try {
    kind = parseWorkloadKind(rawKind);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;

  if (body.action === "scale" && kind === "statefulset") {
    let replicas: number;
    try {
      replicas = parseReplicas(body.replicas);
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 400 });
    }
    try {
      await scaleStatefulSet(id, cfg, ns, name, replicas);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 502 });
    }
  }

  if (body.action === "restart") {
    try {
      await restartWorkload(id, cfg, kind, ns, name);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: formatError(err) }, { status: 502 });
    }
  }

  return NextResponse.json(
    { error: "action must be 'restart', or 'scale' for a statefulset" },
    { status: 400 },
  );
}
