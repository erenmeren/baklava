"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PodRow } from "@/lib/kubernetes/row-types";

interface Props {
  connectionId: string;
  row: PodRow;
  close: () => void;
}

interface Result {
  status: number;
  body: string;
  truncated: boolean;
}

/**
 * Reach a pod's HTTP port through the API server's proxy — health endpoints,
 * metrics, admin pages.
 *
 * Deliberately not `kubectl port-forward`: that opens a local TCP socket on
 * whichever machine runs the forwarder, which for a hosted Baklava is the
 * server rather than the viewer's laptop — useless to the person looking at
 * the screen, and an unauthenticated hole on the host. So this covers HTTP,
 * and non-HTTP ports (a database inside the cluster) stay out of reach.
 */
export function PodProxyOverlay({ connectionId, row, close }: Props) {
  const [port, setPort] = useState("80");
  const [path, setPath] = useState("/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    if (busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ port, path });
      const res = await fetch(
        `/api/kubernetes/${connectionId}/proxy/${encodeURIComponent(
          row.namespace,
        )}/${encodeURIComponent(row.name)}?${qs}`,
        { signal: ac.signal },
      );
      const data = (await res.json().catch(() => ({}))) as Partial<Result> & {
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || `request failed (${res.status})`);
      }
      setResult({
        status: data.status ?? 0,
        body: data.body ?? "",
        truncated: data.truncated ?? false,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div className="relative z-10 w-full max-w-3xl h-[70vh] flex flex-col rounded-lg border border-cyan-500/30 bg-popover shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60 bg-cyan-500/5 font-mono flex items-center gap-2">
          <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
            http
          </span>
          <span className="text-sm font-semibold truncate">
            {row.namespace}/{row.name}
          </span>
          <button
            onClick={close}
            className="ml-auto text-muted-foreground hover:text-foreground text-xs"
          >
            esc
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2 font-mono text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">port</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              className="w-20 rounded border border-border/60 bg-background px-2 py-1 outline-none focus:border-cyan-500/60"
            />
          </label>
          <label className="flex flex-1 items-center gap-1.5">
            <span className="text-muted-foreground">path</span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              className="flex-1 rounded border border-border/60 bg-background px-2 py-1 outline-none focus:border-cyan-500/60"
            />
          </label>
          <button
            onClick={() => void send()}
            disabled={busy}
            className="rounded bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs"
          >
            {busy ? "sending…" : "GET"}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-zinc-950">
          {error ? (
            <pre
              role="alert"
              className="m-4 text-red-400 text-xs whitespace-pre-wrap break-words border border-red-500/30 bg-red-500/10 rounded p-3"
            >
              {error}
            </pre>
          ) : result ? (
            <>
              <div className="px-4 py-2 border-b border-border/40 font-mono text-[11px] flex items-center gap-3">
                <span
                  className={cn(
                    result.status < 400
                      ? "text-emerald-400"
                      : result.status < 500
                        ? "text-amber-400"
                        : "text-red-400",
                  )}
                >
                  {result.status}
                </span>
                <span className="text-zinc-500">{result.body.length} bytes</span>
                {result.truncated ? (
                  <span className="text-amber-400">truncated</span>
                ) : null}
              </div>
              <pre className="px-4 py-3 text-zinc-100 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
                {result.body}
              </pre>
            </>
          ) : (
            <div className="h-full grid place-items-center text-zinc-500 font-mono text-xs px-6 text-center">
              GET a port on this pod through the API server. HTTP only — this is
              not a TCP tunnel, so cluster databases aren&apos;t reachable here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
