import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getRollout, undoRollout } from "@/lib/connections/kubernetes/workload-ops";
import type { KubernetesConfig } from "@/lib/connections/types";
import { parseRevision } from "@/lib/kubernetes/rollout";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; ns: string; name: string }>;
}

function kubeConfig(id: string): KubernetesConfig | null {
  const record = getConnection(id);
  return record && record.tech === "kubernetes" ? (record.config as KubernetesConfig) : null;
}

/** Rollout status + revision history (`kubectl rollout status` / `history`). */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const cfg = kubeConfig(id);
  if (!cfg) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  try {
    return NextResponse.json(await getRollout(id, cfg, ns, name));
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

/** `kubectl rollout undo --to-revision` — body `{ revision }`. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const cfg = kubeConfig(id);
  if (!cfg) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { revision?: unknown };
  let revision: number;
  try {
    revision = parseRevision(body.revision);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
  try {
    await undoRollout(id, cfg, ns, name, revision);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
