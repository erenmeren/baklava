import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  setCronJobSuspended,
  triggerCronJob,
} from "@/lib/connections/kubernetes/workload-ops";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; ns: string; name: string }>;
}

/** `{ action: "trigger" | "suspend" | "resume" }`. */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const cfg = record.config as KubernetesConfig;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (body.action === "trigger") {
      const job = await triggerCronJob(id, cfg, ns, name);
      return NextResponse.json({ ok: true, job });
    }
    if (body.action === "suspend" || body.action === "resume") {
      await setCronJobSuspended(id, cfg, ns, name, body.action === "suspend");
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
  return NextResponse.json(
    { error: "action must be 'trigger', 'suspend' or 'resume'" },
    { status: 400 },
  );
}
