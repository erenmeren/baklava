import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { pullImageStream } from "@/lib/connections/docker";
import { findCredForRef } from "@/lib/connections/registries";
import type { DockerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "docker") {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: "Connection not found" })}\n\n`,
      { status: 404, headers: { "content-type": "text/event-stream" } }
    );
  }
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  if (!ref) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: "ref is required" })}\n\n`,
      { status: 400, headers: { "content-type": "text/event-stream" } }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // controller closed
        }
      };

      let dockerStream: NodeJS.ReadableStream;
      try {
        const cred = findCredForRef(id, ref);
        const auth = cred
          ? {
              username: cred.username,
              password: cred.password,
              serveraddress: cred.serverAddress,
              email: cred.email,
            }
          : undefined;
        dockerStream = await pullImageStream(
          record.config as DockerConfig,
          ref,
          auth
        );
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
        controller.close();
        return;
      }

      safeEnqueue(sse("start", { ref }));

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
            if (event.error) {
              safeEnqueue(sse("error", { message: String(event.error) }));
            } else {
              safeEnqueue(sse("progress", event));
            }
          } catch {
            // ignore non-json lines
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
        safeEnqueue(sse("done", { ref }));
        controller.close();
      });
      dockerStream.once("error", (err) => {
        safeEnqueue(sse("error", { message: formatError(err) }));
        controller.close();
      });

      // Abort handling
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
