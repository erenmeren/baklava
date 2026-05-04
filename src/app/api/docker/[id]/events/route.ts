import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { eventsStream } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
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
  if (!record || record.tech !== "docker") {
    return new Response("Connection not found", { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // closed
        }
      };

      let dockerStream: NodeJS.ReadableStream;
      try {
        dockerStream = await eventsStream(record.config as DockerConfig);
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
        controller.close();
        return;
      }

      safeEnqueue(sse("ready", { ts: Date.now() }));

      // Heartbeat so proxies / Next dev don't drop the stream.
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      let buffer = "";
      const onData = (chunk: Buffer | string) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            safeEnqueue(sse("event", event));
          } catch {
            // ignore malformed
          }
        }
      };

      dockerStream.on("data", onData);
      dockerStream.once("error", (err) => {
        safeEnqueue(sse("error", { message: formatError(err) }));
        clearInterval(heartbeat);
        controller.close();
      });
      dockerStream.once("end", () => {
        safeEnqueue(sse("end", {}));
        clearInterval(heartbeat);
        controller.close();
      });

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        const destroyable = dockerStream as unknown as {
          destroy?: (err?: Error) => void;
        };
        destroyable.destroy?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
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
