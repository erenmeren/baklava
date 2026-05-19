import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  searchMessages,
  type SearchEvent,
  type SearchPredicate,
} from "@/lib/connections/kafka";
import { schemaRegistryFor } from "@/lib/connections/kafka-schema-registry";
import type { KafkaConfig } from "@/lib/connections/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

const encoder = new TextEncoder();
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Streams server-side topic search. Body:
 *   { predicate: SearchPredicate,
 *     matchLimit?: number,        default 100
 *     scanCap?:   number,         default 50_000
 *     startTimestamp?: number     (ms epoch) }
 *
 * Wire events: progress / match / done / error.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return new Response("Connection not found", { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    predicate?: SearchPredicate;
    matchLimit?: number;
    scanCap?: number;
    startTimestamp?: number;
  };
  const predicate = body.predicate ?? {};
  const matchLimit = Math.min(Math.max(body.matchLimit ?? 100, 1), 500);
  const scanCap = Math.min(Math.max(body.scanCap ?? 50_000, 100), 500_000);

  const cfg = record.config as KafkaConfig;
  const schemaRegistry = schemaRegistryFor(id, {
    url: cfg.schemaRegistryUrl ?? "",
    auth: cfg.schemaRegistryAuth,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* closed */
        }
      };

      let aborted = false;
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        aborted = true;
      });

      try {
        await searchMessages(
          cfg,
          decodeURIComponent(topic),
          predicate,
          {
            matchLimit,
            scanCap,
            startTimestamp: body.startTimestamp,
            schemaRegistry,
          },
          (ev: SearchEvent) => {
            if (aborted) return;
            safeEnqueue(sse(ev.kind, ev));
          },
        );
      } catch (err) {
        safeEnqueue(
          sse("error", {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
