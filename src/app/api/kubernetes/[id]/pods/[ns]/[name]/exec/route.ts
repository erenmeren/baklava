import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { startExec } from "@/lib/connections/kubernetes";
import { registerExecSession } from "@/lib/connections/kubernetes-sessions";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; ns: string; name: string }>;
}

interface StartBody {
  shell?: string;
  container?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as StartBody;
  const shell = body.shell || "/bin/sh";
  try {
    const { stdin, output, ws, close } = await startExec(
      id,
      record.config as KubernetesConfig,
      ns,
      name,
      [shell],
      body.container,
    );
    const session = registerExecSession({
      connectionId: id,
      namespace: ns,
      podName: name,
      stdin,
      output,
      ws,
      close,
    });
    return NextResponse.json({ sessionId: session.id, shell });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
