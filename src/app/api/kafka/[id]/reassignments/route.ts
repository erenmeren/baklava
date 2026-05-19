import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  alterReassignments,
  type ReassignmentSpec,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    specs?: ReassignmentSpec[];
  };
  if (!Array.isArray(body.specs) || body.specs.length === 0) {
    return NextResponse.json(
      { error: "specs[] is required" },
      { status: 400 },
    );
  }
  for (const s of body.specs) {
    if (!s.topic || typeof s.partition !== "number" || !Array.isArray(s.replicas)) {
      return NextResponse.json(
        { error: "each spec needs topic, partition, replicas[]" },
        { status: 400 },
      );
    }
  }
  try {
    await alterReassignments(record.config as KafkaConfig, body.specs);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
