import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { drainNode, setNodeSchedulable } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

interface Body {
  action?: "cordon" | "uncordon" | "drain";
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as KubernetesConfig;
  const body = (await req.json().catch(() => ({}))) as Body;

  try {
    if (body.action === "cordon" || body.action === "uncordon") {
      await setNodeSchedulable(id, cfg, name, body.action === "uncordon");
      return NextResponse.json({ ok: true });
    }
    if (body.action === "drain") {
      // Drain reports per-pod eviction failures (PodDisruptionBudgets) rather
      // than failing as a whole — a partial drain is a real, useful outcome.
      return NextResponse.json({ ok: true, ...(await drainNode(id, cfg, name)) });
    }
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
  return NextResponse.json(
    { error: "action must be 'cordon', 'uncordon' or 'drain'" },
    { status: 400 },
  );
}
