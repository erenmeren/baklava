import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { resolveInstallPackages, isInstallAllowed } from "@/lib/techs/install";
import { invalidatePresence } from "@/techs/presence";
import { formatError } from "@/lib/errors";

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

// One in-flight set shared across install AND uninstall — you can't run both for
// the same tech at once. Survives dev HMR via globalThis (per the store pattern);
// read dynamically so tests can replace the Set between runs.
function inFlight(): Set<string> {
  return ((globalThis as Record<symbol, unknown>)[
    Symbol.for("baklava.driverInstalls")
  ] ??= new Set<string>()) as Set<string>;
}

// EventSource forces a GET, which is CSRF-reachable: a page the user visits could
// hit this endpoint (the localhost gate passes for same-machine requests). Impact
// is bounded — only registry-whitelisted driver packages, install or uninstall —
// but we also cap TOTAL concurrent operations so a flood of distinct tech ids
// can't spawn many npm processes at once.
const MAX_CONCURRENT = 2;

export type DriverAction = "install" | "uninstall";

/** Stream `npm <action> <pkgs> --no-save` over SSE for a tech's
 *  registry-derived driver packages.
 *
 * - Local-only gated (403 otherwise); the client only supplies the tech id, and
 *   the package list is derived server-side from the registry — never from input.
 * - `--no-save`: the packages stay declared in optionalDependencies; we only
 *   toggle their presence in node_modules, so reinstall always works and
 *   package.json never churns.
 * - On success, invalidatePresence(packages) so the next render re-checks disk
 *   (a tile re-enables after install / dims after uninstall without a restart). */
export function driverNpmStream(
  req: NextRequest,
  id: string,
  action: DriverAction,
): Response {
  if (!isInstallAllowed(req.headers.get("host"))) {
    return sseError(`Driver ${action} is only allowed from localhost`, 403);
  }

  let packages: string[];
  try {
    packages = resolveInstallPackages(id);
  } catch (err) {
    return sseError(formatError(err), 400);
  }

  if (inFlight().has(id)) {
    return sseError("A driver operation for this tech is already in progress", 409);
  }
  if (inFlight().size >= MAX_CONCURRENT) {
    return sseError("Too many driver operations in progress; try again shortly", 429);
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
        child = spawn("npm", [action, ...packages, "--no-save"], { cwd: process.cwd() });
      } catch (err) {
        finish(() => safeEnqueue(sse("error", { message: formatError(err) })));
        return;
      }

      req.signal.addEventListener("abort", () => {
        child.kill();
        finish(() => {});
      });

      safeEnqueue(sse("start", { action, packages }));

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
            safeEnqueue(sse("done", { action, packages }));
          } else {
            safeEnqueue(sse("error", { message: `npm ${action} exited with code ${code}` }));
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
