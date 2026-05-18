import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  getConsumerGroupState,
  skipPartitionOffset,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; group: string }>;
}

interface Body {
  topic?: string;
  partition?: number;
  count?: number;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, group } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.topic || typeof body.partition !== "number") {
    return NextResponse.json(
      { error: "topic and partition are required" },
      { status: 400 },
    );
  }
  const groupId = decodeURIComponent(group);

  // Same pre-flight as reset: Kafka requires the group to be Empty.
  try {
    const state = await getConsumerGroupState(
      record.config as KafkaConfig,
      groupId,
    );
    if (state && state !== "Empty") {
      return NextResponse.json(
        {
          error: `Group is ${state}, not Empty`,
          state,
          hint:
            state === "Stable"
              ? "Stop all consumers in this group, then try again."
              : "Group is rebalancing — wait ~10s for it to settle, then try again.",
        },
        { status: 409 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }

  try {
    const result = await skipPartitionOffset(
      record.config as KafkaConfig,
      groupId,
      body.topic,
      body.partition,
      body.count ?? 1,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
