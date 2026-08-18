import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  readResourceYaml,
  replaceResourceYaml,
  deleteResource,
} from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  // For cluster-scoped kinds (namespaces) the ns query param is absent;
  // for namespaced kinds the route reads `?namespace=…`.
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
    const yaml = await readResourceYaml(
      id,
      record.config as KubernetesConfig,
      kind,
      ns,
      name,
    );
    return NextResponse.json({ yaml });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

interface PutBody {
  yaml: string;
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.yaml?.trim()) {
    return NextResponse.json({ error: "yaml is required" }, { status: 400 });
  }
  try {
    await replaceResourceYaml(id, record.config as KubernetesConfig, body.yaml);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id, kind, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const ns = req.nextUrl.searchParams.get("namespace") || undefined;
  try {
    await deleteResource(id, record.config as KubernetesConfig, kind, ns, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
