import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: KubernetesConfig;
  save?: boolean;
}

/**
 * UI-shell stub: pretends every connection works and synthesises a probe.
 * The real driver (@kubernetes/client-node) will replace the body of this
 * function later — request/response shape and error handling already match
 * the production contract.
 */
export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.config?.source) {
    return NextResponse.json(
      { error: "Kubeconfig source is required" },
      { status: 400 },
    );
  }
  if (
    body.config.source === "path" &&
    !body.config.kubeconfigPath?.trim()
  ) {
    return NextResponse.json(
      { error: "Kubeconfig path is required" },
      { status: 400 },
    );
  }
  if (
    body.config.source === "inline" &&
    !body.save &&
    !body.config.kubeconfigYaml?.trim()
  ) {
    return NextResponse.json(
      { error: "Paste a kubeconfig YAML to test" },
      { status: 400 },
    );
  }

  try {
    const probe = {
      context: body.config.context?.trim() || "current-context",
      serverVersion: "v1.31.0",
      nodeCount: 3,
    };
    const record = body.save
      ? saveConnection({
          tech: "kubernetes",
          name: body.name || "Cluster",
          config: body.config,
          status: "ok",
        })
      : null;
    return NextResponse.json({
      ok: true,
      probe,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 },
    );
  }
}
