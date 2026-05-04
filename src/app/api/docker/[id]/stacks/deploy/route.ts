import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  ComposeParseError,
  type DeployEvent,
  deployStack,
  parseCompose,
} from "@/lib/connections/compose";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  name?: string;
  compose?: string;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return new Response("Connection not found", { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.name?.trim() || !body.compose?.trim()) {
    return new Response("name and compose are required", { status: 400 });
  }

  let parsed;
  try {
    parsed = parseCompose(body.name.trim(), body.compose);
  } catch (err) {
    const errors =
      err instanceof ComposeParseError
        ? err.errors.map((e) => e.message)
        : [err instanceof Error ? err.message : String(err)];
    return new Response(
      JSON.stringify({ error: "Compose parse failed", errors }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
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
      const emit = (event: DeployEvent) => {
        safeEnqueue(sse(event.type, event));
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      let aborted = false;
      req.signal.addEventListener("abort", () => {
        aborted = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      try {
        await deployStack(
          record.config as DockerConfig,
          id,
          parsed,
          (event) => {
            if (!aborted) emit(event);
          }
        );
      } catch (err) {
        emit({ type: "error", message: formatError(err) });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
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
