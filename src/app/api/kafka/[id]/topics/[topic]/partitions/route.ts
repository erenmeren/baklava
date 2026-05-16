import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { addTopicPartitions } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    totalPartitions?: number;
  };
  const total = Number(body.totalPartitions);
  if (!Number.isInteger(total) || total < 1) {
    return NextResponse.json(
      { error: "totalPartitions must be a positive integer" },
      { status: 400 }
    );
  }
  try {
    await addTopicPartitions(
      record.config as KafkaConfig,
      decodeURIComponent(topic),
      total
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
