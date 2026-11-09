import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { applyManifests } from "@/lib/connections/kubernetes/apply";
import type { KubernetesConfig } from "@/lib/connections/types";
import { ManifestError, MAX_MANIFEST_BYTES } from "@/lib/kubernetes/manifests";
import { ALL_NAMESPACES } from "@/lib/kubernetes/namespace";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  yaml?: unknown;
  namespace?: unknown;
  dryRun?: unknown;
  force?: unknown;
}

/**
 * Server-side apply (fieldManager "baklava") of a multi-document manifest.
 * `dryRun: true` previews: the API server validates and defaults but persists
 * nothing. A POST under /api/kubernetes/<id>/, so the proxy's write floor
 * requires `write` — even for a dry run, which still reveals what exists.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.yaml !== "string" || !body.yaml.trim()) {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }
  if (typeof body.dryRun !== "boolean") {
    return NextResponse.json({ error: "dryRun must be a boolean" }, { status: 400 });
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return NextResponse.json({ error: "force must be a boolean" }, { status: 400 });
  }
  if (body.namespace !== undefined && typeof body.namespace !== "string") {
    return NextResponse.json({ error: "namespace must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(body.yaml) > MAX_MANIFEST_BYTES) {
    return NextResponse.json({ error: "YAML is too large" }, { status: 413 });
  }
  const namespace =
    body.namespace && body.namespace !== ALL_NAMESPACES ? body.namespace : undefined;
  try {
    const results = await applyManifests(id, record.config as KubernetesConfig, body.yaml, {
      namespace,
      dryRun: body.dryRun,
      force: body.force ?? false,
    });
    return NextResponse.json({ dryRun: body.dryRun, results });
  } catch (err) {
    if (err instanceof ManifestError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
