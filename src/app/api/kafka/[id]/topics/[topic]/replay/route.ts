import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { replayDeadLetters } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

interface Body {
  targetTopic?: string;
  picks?: Array<{ partition: number; offset: string }>;
  stripHeaderPrefixes?: string[];
  dryRun?: boolean;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!Array.isArray(body.picks) || body.picks.length === 0) {
    return NextResponse.json(
      { error: "picks[] is required" },
      { status: 400 },
    );
  }
  try {
    const result = await replayDeadLetters(record.config as KafkaConfig, {
      sourceTopic: decodeURIComponent(topic),
      targetTopic: body.targetTopic,
      picks: body.picks,
      stripHeaderPrefixes: body.stripHeaderPrefixes,
      dryRun: body.dryRun,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
