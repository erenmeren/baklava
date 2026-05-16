import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
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
  try {
    await resetGroupOffsets(
      record.config as KafkaConfig,
      decodeURIComponent(group),
      body.topic,
      body.target as ResetOffsetTarget,
      body.partitions
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
