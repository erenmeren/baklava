import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import {
  createTopic,
  listTopics,
  listTopicsWithStats,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const includeInternal = req.nextUrl.searchParams.get("internal") === "1";
  const stats = req.nextUrl.searchParams.get("stats") === "1";
  try {
    const all = stats
      ? await listTopicsWithStats(record.config as KafkaConfig)
      : await listTopics(record.config as KafkaConfig);
    const topics = includeInternal ? all : all.filter((t) => !t.internal);
    updateStatus(id, "ok");
    return NextResponse.json({ topics });
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    partitions?: number;
    replicationFactor?: number;
  };
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    await createTopic(
      record.config as KafkaConfig,
      body.name,
      Math.max(1, Number(body.partitions) || 1),
      Math.max(1, Number(body.replicationFactor) || 1)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
