import { getLoadTest } from "@/lib/loadtest/store";
import { executeRun } from "@/lib/loadtest/run-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const test = getLoadTest(id);
  if (!test) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* closed */
        }
      };
      // 15s heartbeat keeps Next dev / proxies from dropping the connection.
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);

      try {
        const run = await executeRun(
          test,
          {
            onProgress: (line) => safeEnqueue(sse("progress", { line })),
            onResult: (result) => safeEnqueue(sse("result", result)),
            onError: (message) => safeEnqueue(sse("error", { message })),
          },
          { signal: req.signal },
        );
        safeEnqueue(sse("done", { runId: run.id, status: run.status }));
      } catch (err) {
        safeEnqueue(sse("error", { message: err instanceof Error ? err.message : String(err) }));
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
