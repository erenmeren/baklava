import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  streamWorkloadLogs,
  type WorkloadLogSource,
} from "@/lib/connections/kubernetes/workload-ops";
import type { KubernetesConfig } from "@/lib/connections/types";
import { MAX_LOG_PODS, parseWorkloadKind } from "@/lib/kubernetes/workload-ops";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; kind: string; ns: string; name: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stern-style logs: one SSE stream carrying every pod of a workload. Events:
 * `pods` (who is followed, once), `line` ({ pod, color, text }), `pod-end`
 * (one pod's stream closed), `end` (all closed), `error`.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, kind: rawKind, ns, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return new Response("Connection not found", { status: 404 });
  }
  let kind;
  try {
    kind = parseWorkloadKind(rawKind);
  } catch (err) {
    return new Response(formatError(err), { status: 400 });
  }
  const container = req.nextUrl.searchParams.get("container") ?? undefined;

  let sources: WorkloadLogSource[] = [];
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // closed
        }
      };
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);

      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        for (const s of sources) s.stream.abort();
        try {
          controller.close();
        } catch {
          // ignore
        }
      };
      req.signal.addEventListener("abort", cleanup);

      try {
        const result = await streamWorkloadLogs(id, record.config as KubernetesConfig, kind, ns, name, {
          container,
        });
        sources = result.sources;
        // The client went away while we were opening streams.
        if (closed || req.signal.aborted) {
          cleanup();
          return;
        }
        safeEnqueue(
          sse("pods", {
            pods: sources.map((s) => ({ pod: s.pod, container: s.container, color: s.color })),
            truncated: result.truncated,
            max: MAX_LOG_PODS,
          }),
        );
        if (sources.length === 0) {
          safeEnqueue(sse("end", { reason: "no pods" }));
          cleanup();
          return;
        }

        let open = sources.length;
        for (const s of sources) {
          let leftover = "";
          const emit = (text: string) =>
            safeEnqueue(sse("line", { pod: s.pod, color: s.color, text }));
          s.stream.output.on("data", (chunk: Buffer | string) => {
            const lines = (leftover + chunk.toString()).split("\n");
            leftover = lines.pop() ?? "";
            for (const line of lines) if (line) emit(line);
          });
          // One pod ending (or failing) must not end the others.
          let done = false;
          const finish = (err?: Error) => {
            if (done) return;
            done = true;
            if (leftover) emit(leftover);
            safeEnqueue(sse("pod-end", { pod: s.pod, error: err ? formatError(err) : undefined }));
            open -= 1;
            if (open === 0) {
              safeEnqueue(sse("end", { reason: "eof" }));
              cleanup();
            }
          };
          s.stream.output.on("end", () => finish());
          s.stream.output.on("error", (err: Error) => finish(err));
        }
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
