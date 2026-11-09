"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DeploymentRow } from "@/lib/kubernetes/row-types";
import type { Revision, RolloutStatus } from "@/lib/kubernetes/rollout";
import { ConfirmOverlay } from "../confirm-overlay";

interface Props {
  connectionId: string;
  row: DeploymentRow;
  close: () => void;
  refresh: () => void;
}

/**
 * `kubectl rollout status` + `history`, with a per-revision roll back
 * (`rollout undo --to-revision`) behind the shared confirm overlay.
 */
export function RolloutOverlay({ connectionId, row, close, refresh }: Props) {
  const url = `/api/kubernetes/${connectionId}/deployments/${encodeURIComponent(
    row.namespace,
  )}/${encodeURIComponent(row.name)}/rollout`;
  const [data, setData] = useState<{ status: RolloutStatus; history: Revision[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(url, { signal: ac.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `request failed (${res.status})`);
      setData(body);
      setError(null);
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !confirm) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, confirm]);

  async function rollBack(rev: Revision) {
    setConfirm(null);
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: rev.revision }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error || `request failed (${res.status})`);
      refresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const s = data?.status;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] pointer-events-none" />
      <div className="relative z-10 w-full max-w-2xl rounded-lg border border-border/70 bg-popover shadow-2xl overflow-hidden font-mono">
        <div className="px-5 py-3 border-b border-border/60 bg-muted/30 flex items-center gap-2">
          <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
            rollout
          </span>
          <span className="text-sm font-semibold truncate">
            {row.namespace}/{row.name}
          </span>
          <button
            onClick={close}
            className="ml-auto text-muted-foreground hover:text-foreground text-xs"
          >
            esc to close
          </button>
        </div>
        <div className="px-5 py-4 text-xs space-y-4 max-h-[70vh] overflow-auto">
          {error ? (
            <span role="alert" className="block text-destructive whitespace-pre-wrap">
              {error}
            </span>
          ) : null}
          {s ? (
            <div className="space-y-1">
              <div className="flex gap-4">
                <span>desired {s.desired}</span>
                <span>updated {s.updated}</span>
                <span>ready {s.ready}</span>
                <span>available {s.available}</span>
                <span
                  className={
                    s.complete
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  {s.paused ? "paused" : s.complete ? "rolled out" : "progressing"}
                </span>
              </div>
              {s.progressing ? (
                <div className="text-muted-foreground">
                  Progressing={s.progressing.status} · {s.progressing.reason} —{" "}
                  {s.progressing.message}
                </div>
              ) : null}
            </div>
          ) : !error ? (
            <div className="text-muted-foreground">loading…</div>
          ) : null}
          {data ? (
            <table className="w-full">
              <thead className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                <tr>
                  <th className="text-left py-1 w-12">rev</th>
                  <th className="text-left py-1">image</th>
                  <th className="text-left py-1">change-cause</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {data.history.map((r) => (
                  <tr key={r.revision} className={cn(r.current && "text-emerald-600 dark:text-emerald-400")}>
                    <td className="py-1 tabular-nums">{r.revision}</td>
                    <td className="py-1 break-all">{r.images.join(", ")}</td>
                    <td className="py-1 text-muted-foreground">{r.changeCause || "—"}</td>
                    <td className="py-1 text-right">
                      {r.current ? (
                        "current"
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => setConfirm(r)}
                          className="rounded border border-red-500/40 px-2 py-0.5 hover:bg-red-500/10 disabled:opacity-60"
                        >
                          roll back
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
      {confirm ? (
        <ConfirmOverlay
          title={`Roll back to revision ${confirm.revision}?`}
          body={
            <>
              Replaces the pod template of{" "}
              <span className="font-mono text-foreground">
                {row.namespace}/{row.name}
              </span>{" "}
              with revision {confirm.revision} ({confirm.images.join(", ")}) — every pod is
              replaced, like <span className="font-mono">kubectl rollout undo</span>.
            </>
          }
          confirmLabel={`Roll back to ${confirm.revision}`}
          onClose={() => setConfirm(null)}
          onConfirm={() => void rollBack(confirm)}
        />
      ) : null}
    </div>
  );
}
