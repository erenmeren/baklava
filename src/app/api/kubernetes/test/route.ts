import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropKubernetesClient, probe } from "@/lib/connections/kubernetes";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hostLocalForbidden, hostLocalReason } from "@/lib/connections/host-local";
import { egressRejection } from "@/lib/net/connection-targets";

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

  // Even a probe runs host-local configs (kubeconfig exec plugins spawn), so
  // gate before probing, not just before saving.
  const user = getCurrentUser(req);
  const hostLocal = hostLocalReason("kubernetes", body.config);
  if (hostLocal && user?.role !== "admin") return hostLocalForbidden(hostLocal);

  const egress = await egressRejection("kubernetes", body.config);
  if (egress) return egress;
  // Probe with a temporary id so the cached client doesn't poison a real
  // record if the user is about to save under a different id.
  const probeId = `__probe_${randomUUID()}`;
  try {
    const result = await probe(probeId, body.config);
    const record = body.save
      ? saveConnection({
          tech: "kubernetes",
          name: body.name || "Cluster",
          config: body.config,
          status: "ok",
          ownerId: user?.id,
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
