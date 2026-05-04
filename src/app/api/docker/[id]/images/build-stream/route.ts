import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { buildImageStream } from "@/lib/connections/docker";
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

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return new Response("Connection not found", { status: 404 });
  }

  let body: { dockerfile?: string; tag?: string };
  try {
    body = (await req.json()) as { dockerfile?: string; tag?: string };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!body.dockerfile?.trim()) {
    return new Response("dockerfile is required", { status: 400 });
  }
  if (!body.tag?.trim()) {
    return new Response("tag is required", { status: 400 });
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
        dockerStream = await buildImageStream(
          record.config as DockerConfig,
          body.dockerfile!,
          body.tag!.trim()
        );
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
        controller.close();
        return;
      }

      safeEnqueue(sse("start", { tag: body.tag }));

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
            if (event.errorDetail || event.error) {
              safeEnqueue(
                sse("error", {
                  message:
                    event.errorDetail?.message ||
                    event.error ||
                    "build failed",
                })
              );
            } else {
              safeEnqueue(sse("progress", event));
            }
          } catch {
            // ignore
          }
        }
      };

      dockerStream.on("data", onData);
      dockerStream.once("end", () => {
        if (buffer.trim()) {
          try {
            safeEnqueue(sse("progress", JSON.parse(buffer)));
          } catch {
            // ignore
          }
        }
        safeEnqueue(sse("done", { tag: body.tag }));
        controller.close();
      });
      dockerStream.once("error", (err) => {
        safeEnqueue(sse("error", { message: formatError(err) }));
        controller.close();
      });

      req.signal.addEventListener("abort", () => {
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
