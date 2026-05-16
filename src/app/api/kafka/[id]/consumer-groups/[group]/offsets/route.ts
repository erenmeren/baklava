import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  getConsumerGroupState,
  resetGroupOffsets,
  type ResetOffsetTarget,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; group: string }>;
}

type Body = {
  topic?: string;
  target?:
    | { kind: "earliest" }
    | { kind: "latest" }
    | { kind: "timestamp"; timestamp: number }
    | { kind: "offset"; offset: string };
  partitions?: number[];
};

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, group } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.topic || !body.target?.kind) {
    return NextResponse.json(
      { error: "topic and target are required" },
      { status: 400 }
    );
  }
  const groupId = decodeURIComponent(group);

  // Pre-flight: Kafka requires the group to be Empty before any reset.
  // Check up front so we can return a friendly error instead of a raw
  // GroupNotEmptyException message from the broker.
  try {
    const state = await getConsumerGroupState(
      record.config as KafkaConfig,
      groupId
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
        { status: 409 }
      );
    }
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }

  try {
    await resetGroupOffsets(
      record.config as KafkaConfig,
      groupId,
      body.topic,
      body.target as ResetOffsetTarget,
      body.partitions
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
