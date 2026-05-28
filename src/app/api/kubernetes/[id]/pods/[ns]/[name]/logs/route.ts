import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { streamPodLogs } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; ns: string; name: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return new Response("Connection not found", { status: 404 });
  }
  const tailLines = Number(req.nextUrl.searchParams.get("tailLines") ?? "200");
  const container = req.nextUrl.searchParams.get("container") ?? undefined;

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
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

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
        const { output, abort } = await streamPodLogs(
          id,
          record.config as KubernetesConfig,
          ns,
          name,
          { follow: true, tailLines, container },
        );
        stop = abort;

        let leftover = "";
        output.on("data", (chunk: Buffer | string) => {
          const text =
            (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
          const combined = leftover + text;
          const lines = combined.split("\n");
          leftover = lines.pop() ?? "";
          for (const line of lines) {
            if (line.length === 0) continue;
            safeEnqueue(sse("line", { text: line }));
          }
        });
        output.on("end", () => {
          if (leftover) safeEnqueue(sse("line", { text: leftover }));
          safeEnqueue(sse("end", { reason: "eof" }));
          cleanup();
        });
        output.on("error", (err: Error) => {
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
