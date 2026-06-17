import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { resolveInstallPackages, isInstallAllowed } from "@/lib/techs/install";
import { invalidatePresence } from "@/techs/presence";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseError(message: string, status: number) {
  return new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

// In-flight installs, survives dev HMR via globalThis (per the store pattern).
// Read dynamically so tests can replace the Set between runs.
function inFlight(): Set<string> {
  return ((globalThis as Record<symbol, unknown>)[
    Symbol.for("baklava.driverInstalls")
  ] ??= new Set<string>()) as Set<string>;
}

// EventSource forces a GET, which is CSRF-reachable: a page the user visits could
// hit this endpoint (the localhost gate passes for same-machine requests). Impact
// is bounded — only registry-whitelisted driver packages can ever be installed —
// but we also cap TOTAL concurrent installs so a flood of distinct tech ids can't
// spawn many npm processes at once.
const MAX_CONCURRENT_INSTALLS = 2;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  if (!isInstallAllowed(req.headers.get("host"))) {
    return sseError("Driver install is only allowed from localhost", 403);
  }

  let packages: string[];
  try {
    packages = resolveInstallPackages(id);
  } catch (err) {
    return sseError(formatError(err), 400);
  }

  if (inFlight().has(id)) {
    return sseError("An install for this tech is already in progress", 409);
  }

  if (inFlight().size >= MAX_CONCURRENT_INSTALLS) {
    return sseError("Too many driver installs in progress; try again shortly", 429);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };

      inFlight().add(id);
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        inFlight().delete(id);
        fn();
        try { controller.close(); } catch { /* closed */ }
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("npm", ["install", ...packages], { cwd: process.cwd() });
      } catch (err) {
        finish(() => safeEnqueue(sse("error", { message: formatError(err) })));
        return;
      }

      req.signal.addEventListener("abort", () => {
        child.kill();
        finish(() => {});
      });

      safeEnqueue(sse("start", { packages }));

      const onData = (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) safeEnqueue(sse("progress", { line }));
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      child.on("error", (err) => {
        finish(() => safeEnqueue(sse("error", { message: formatError(err) })));
      });

      child.on("close", (code) => {
        finish(() => {
          if (code === 0) {
            invalidatePresence(packages);
            safeEnqueue(sse("done", { installed: packages }));
          } else {
            safeEnqueue(sse("error", { message: `npm install exited with code ${code}` }));
          }
        });
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
