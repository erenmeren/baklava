import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { streamContainerLogs, type StreamLogsHandle } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; cid: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseTail(raw: string | null): number | "all" {
  if (!raw) return 400;
  if (raw === "all") return "all";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 400;
  return Math.min(Math.floor(n), 100_000);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, cid } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return new Response("Connection not found", { status: 404 });
  }

  const tail = parseTail(req.nextUrl.searchParams.get("tail"));
  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw && Number.isFinite(Number(sinceRaw))
    ? Math.floor(Number(sinceRaw))
    : undefined;
  const timestamps = req.nextUrl.searchParams.get("timestamps") === "1";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // closed
        }
      };

      let handle: StreamLogsHandle | null = null;
      let closed = false;
      const closeOnce = () => {
        if (closed) return;
        closed = true;
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
        handle?.destroy();
        closeOnce();
      });

      safeEnqueue(sse("ready", { tail, since, timestamps }));

      try {
        handle = await streamContainerLogs(
          record.config as DockerConfig,
          cid,
          { tail, since, timestamps },
          (line) => safeEnqueue(sse("line", line)),
          (err) => {
            safeEnqueue(sse("error", { message: formatError(err) }));
            clearInterval(heartbeat);
            closeOnce();
          },
          () => {
            safeEnqueue(sse("end", {}));
            clearInterval(heartbeat);
            closeOnce();
          }
        );
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
        clearInterval(heartbeat);
        closeOnce();
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
