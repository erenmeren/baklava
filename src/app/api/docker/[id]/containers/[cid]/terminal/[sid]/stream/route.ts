import { NextRequest } from "next/server";
import { getSession } from "@/lib/connections/terminal-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; cid: string; sid: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { sid } = await ctx.params;
  const session = getSession(sid);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // closed
        }
      };

      // Replay any pre-buffered output.
      if (session.buffer.length > 0) {
        const replay = Buffer.concat(session.buffer);
        session.buffer = [];
        session.bufferBytes = 0;
        safeEnqueue(sse("data", replay.toString("base64")));
      }

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      const onData = (buf: Buffer) => {
        safeEnqueue(sse("data", buf.toString("base64")));
      };
      const onClose = (reason: { code?: number | null }) => {
        safeEnqueue(sse("end", reason));
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      session.listeners.add(onData);
      session.closeListeners.add(onClose);

      req.signal.addEventListener("abort", () => {
        session.listeners.delete(onData);
        session.closeListeners.delete(onClose);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      if (session.closed) {
        onClose({ code: null });
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
