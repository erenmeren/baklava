import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { proxyPodHttp } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { effectiveAccess } from "@/lib/connections/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; ns: string; name: string }>;
}

/**
 * GET a pod's HTTP port through the API server's proxy subresource.
 *
 * Requires `write`, even though it is a GET. Kubernetes treats `pods/proxy`
 * as a privileged subresource for good reason: this issues a request from
 * inside the cluster on the connection's credentials, and Baklava cannot know
 * whether the pod treats a GET as a read — `/admin/shutdown` is a GET in
 * plenty of software. A `read` grant means look at the cluster, not reach
 * into a workload with it.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const user = getCurrentUser(req);
  const access = user
    ? effectiveAccess({
        user: { id: user.id, role: user.role },
        conn: { id: record.id, ownerId: record.ownerId },
      })
    : "none";
  if (access !== "write") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const port = req.nextUrl.searchParams.get("port") ?? "";
  const path = req.nextUrl.searchParams.get("path") ?? "/";
  try {
    const result = await proxyPodHttp(
      id,
      record.config as KubernetesConfig,
      ns,
      name,
      port,
      path,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = formatError(err);
    // A rejected port/path/name is the caller's mistake, not the cluster's.
    const bad = /^Invalid (pod name|port|path)|^Port is required/.test(message);
    return NextResponse.json({ error: message }, { status: bad ? 400 : 502 });
  }
}
