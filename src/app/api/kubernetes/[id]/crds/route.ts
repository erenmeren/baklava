import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listCrdLinks } from "@/lib/connections/kubernetes/crds";
import type { KubernetesConfig } from "@/lib/connections/types";
import { effectiveAccess } from "@/lib/connections/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Installed CRDs for the sidebar's "Custom resources" group. A read: the proxy
 * gates `/api/kubernetes/<id>/…`; the handler checks again (404 on `none`).
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  const user = getCurrentUser(req);
  const access =
    record && user
      ? effectiveAccess({
          user: { id: user.id, role: user.role },
          conn: { id: record.id, ownerId: record.ownerId },
        })
      : "none";
  if (!record || record.tech !== "kubernetes" || access === "none") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    return NextResponse.json({ crds: await listCrdLinks(id, record.config as KubernetesConfig) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
