import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { startMessageTail, type TailHandle } from "@/lib/connections/kafka";
import { schemaRegistryFor } from "@/lib/connections/kafka-schema-registry";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; topic: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, topic } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return new Response("Connection not found", { status: 404 });
  }
  const partitionStr = req.nextUrl.searchParams.get("partition");
  const partition =
    partitionStr != null && Number.isFinite(Number(partitionStr))
      ? Number(partitionStr)
      : undefined;
  const fromBeginning = req.nextUrl.searchParams.get("fromBeginning") === "1";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // closed
        }
      };

      let handle: TailHandle | null = null;
      let closed = false;
      const closeOnce = async () => {
        if (closed) return;
        closed = true;
        try {
          await handle?.stop();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        void closeOnce();
      });

      safeEnqueue(sse("ready", { topic: decodeURIComponent(topic) }));

      try {
        const cfg = record.config as KafkaConfig;
        const schemaRegistry = schemaRegistryFor(id, {
          url: cfg.schemaRegistryUrl ?? "",
          auth: cfg.schemaRegistryAuth,
        });
        handle = await startMessageTail(
          cfg,
          {
            topic: decodeURIComponent(topic),
            fromBeginning,
            partition,
            schemaRegistry,
          },
          (m) => safeEnqueue(sse("message", m)),
          (err) => {
            safeEnqueue(sse("error", { message: formatError(err) }));
            clearInterval(heartbeat);
            void closeOnce();
          }
        );
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
        clearInterval(heartbeat);
        void closeOnce();
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
