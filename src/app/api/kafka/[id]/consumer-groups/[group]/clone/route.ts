import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { cloneConsumerGroup } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; group: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, group } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { targetGroupId?: string };
  const target = body.targetGroupId?.trim();
  if (!target) {
    return NextResponse.json(
      { error: "targetGroupId is required" },
      { status: 400 },
    );
  }
  try {
    const result = await cloneConsumerGroup(
      record.config as KafkaConfig,
      decodeURIComponent(group),
      target,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
