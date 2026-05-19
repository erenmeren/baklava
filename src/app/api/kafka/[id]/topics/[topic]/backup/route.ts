import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  streamTopicBackup,
  restoreTopic,
  type PartitionStrategy,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

/**
 * GET — streams the topic to JSONL (one message per line) as a download.
 * Query params:
 *   limit=N          cap message count (default 0 = all)
 *   since=<ms epoch> only messages at/after this timestamp
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return new Response("Connection not found", { status: 404 });
  }
  const t = decodeURIComponent(topic);
  const limit = Number(req.nextUrl.searchParams.get("limit") || "0") || 0;
  const sinceStr = req.nextUrl.searchParams.get("since");
  const startTimestamp = sinceStr ? Number(sinceStr) : undefined;

  const encoder = new TextEncoder();
  const gen = streamTopicBackup(record.config as KafkaConfig, t, {
    limit,
    startTimestamp,
  });

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ _error: formatError(err) }) + "\n",
          ),
        );
        controller.close();
      }
    },
    async cancel() {
      await gen.return?.(undefined);
    },
  });

  const filename = `${t}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.jsonl`;
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * POST — restore from an uploaded JSONL backup.
 * Query params:
 *   target=<topic>            produce here instead of the path topic
 *   partitions=original|auto  partition strategy (default auto)
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const target =
    req.nextUrl.searchParams.get("target") || decodeURIComponent(topic);
  const strategy: PartitionStrategy =
    req.nextUrl.searchParams.get("partitions") === "original"
      ? "original"
      : "auto";
  const jsonl = await req.text();
  if (!jsonl.trim()) {
    return NextResponse.json({ error: "Empty backup body" }, { status: 400 });
  }
  try {
    const result = await restoreTopic(
      record.config as KafkaConfig,
      target,
      jsonl,
      strategy,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
