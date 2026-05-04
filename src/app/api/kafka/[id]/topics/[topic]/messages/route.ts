import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { fetchMessages, produceMessage } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") || "50"), 1),
    500
  );
  const partitionStr = req.nextUrl.searchParams.get("partition");
  const partition = partitionStr != null ? Number(partitionStr) : undefined;
  const fromBeginning =
    req.nextUrl.searchParams.get("from") === "beginning";
  try {
    const messages = await fetchMessages(
      record.config as KafkaConfig,
      decodeURIComponent(topic),
      { partition, limit, fromBeginning }
    );
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    value?: string;
    headers?: Record<string, string>;
  };
  if (body.value == null) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }
  try {
    await produceMessage(
      record.config as KafkaConfig,
      decodeURIComponent(topic),
      { key: body.key, value: body.value, headers: body.headers }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
