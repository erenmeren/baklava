import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { fetchMessagesFromOffset } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

interface Body {
  partition?: number;
  offset?: string;
  limit?: number;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (typeof body.partition !== "number" || !body.offset) {
    return NextResponse.json(
      { error: "partition and offset are required" },
      { status: 400 },
    );
  }
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
  try {
    const messages = await fetchMessagesFromOffset(
      record.config as KafkaConfig,
      decodeURIComponent(topic),
      body.partition,
      body.offset,
      limit,
    );
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
