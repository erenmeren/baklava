import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { startMonitor } from "@/lib/connections/redis";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "redis") {
    return new Response("Connection not found", { status: 404 });
  }

  let stop: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // closed
        }
      };
      const heartbeat = setInterval(
        () => safeEnqueue(encoder.encode(": ping\n\n")),
        15_000,
      );
      const cleanup = () => {
        clearInterval(heartbeat);
        try {
          stop?.();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };
      req.signal.addEventListener("abort", cleanup);

      try {
        const mon = await startMonitor(record.config as RedisConfig);
        stop = mon.close;
        let partial = "";
        mon.output.on("data", (chunk: Buffer | string) => {
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          const combined = partial + text;
          const lines = combined.split("\n");
          partial = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            try {
              const payload = JSON.parse(line);
              safeEnqueue(sse(payload.kind ?? "monitor", payload));
            } catch {
              safeEnqueue(sse("raw", { text: line }));
            }
          }
        });
        mon.output.on("end", cleanup);
        mon.output.on("error", (err: Error) => {
          safeEnqueue(sse("error", { message: formatError(err) }));
          cleanup();
        });
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
        cleanup();
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
