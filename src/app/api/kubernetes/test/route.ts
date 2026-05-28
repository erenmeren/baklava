import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropKubernetesClient, probe } from "@/lib/connections/kubernetes";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: KubernetesConfig;
  save?: boolean;
}

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

  // Probe with a temporary id so the cached client doesn't poison a real
  // record if the user is about to save under a different id.
  const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await probe(probeId, body.config);
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
      probe: result,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 },
    );
  } finally {
    dropKubernetesClient(probeId);
  }
}
