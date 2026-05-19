import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { fetchPulse } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/kafka/[id]/pulse — one cheap health snapshot for the cluster
 * pulse strip on the overview page. Designed to be polled every 5s.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const sample = await fetchPulse(record.config as KafkaConfig);
    return NextResponse.json(sample);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
