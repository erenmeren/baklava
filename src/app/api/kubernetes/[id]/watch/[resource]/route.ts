import { NextRequest } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { WATCH_SPECS, watchResource } from "@/lib/connections/kubernetes/watch";
import type { KubernetesConfig } from "@/lib/connections/types";
import { effectiveAccess } from "@/lib/connections/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveNamespace } from "@/lib/kubernetes/namespace";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; resource: string }>;
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Live updates for one workspace list, as SSE: `reset` (a full bounded list —
 * first, and again after a 410 Gone), `upsert` (a mapped row), `delete` (a
 * row key), `error` (then the stream ends; the client reconnects).
 *
 * A read: the proxy gates `/api/kubernetes/<id>/…` already; the handler checks
 * again (404 on `none`, like the connection CRUD GET) as defense in depth.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, resource } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kubernetes") {
    return new Response("Connection not found", { status: 404 });
  }
  const user = getCurrentUser(req);
  const access = user
    ? effectiveAccess({
        user: { id: user.id, role: user.role },
        conn: { id: record.id, ownerId: record.ownerId },
      })
    : "none";
  if (access === "none") {
    return new Response("Connection not found", { status: 404 });
  }
  if (!Object.hasOwn(WATCH_SPECS, resource)) {
    return new Response("Unknown resource", { status: 404 });
  }
  const cfg = record.config as KubernetesConfig;
  const namespace = resolveNamespace(
    req.nextUrl.searchParams.get("ns") ?? undefined,
    cfg.namespace,
  );

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
      const upstream = new AbortController();
      const close = () => {
        clearInterval(heartbeat);
        upstream.abort();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", close);

      try {
        await watchResource(
          id,
          cfg,
          resource,
          namespace,
          {
            reset: (payload) => safeEnqueue(sse("reset", payload)),
            upsert: (row) => safeEnqueue(sse("upsert", row)),
            remove: (key) => safeEnqueue(sse("delete", { key })),
          },
          upstream.signal,
        );
      } catch (err) {
        safeEnqueue(sse("error", { message: formatError(err) }));
      }
      close();
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
