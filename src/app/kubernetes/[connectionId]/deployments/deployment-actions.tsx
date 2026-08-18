"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DeploymentRow } from "@/lib/kubernetes/row-types";

interface Props {
  connectionId: string;
  row: DeploymentRow;
  close: () => void;
  refresh: () => void;
}

/** `ready` is rendered as "<available>/<desired>" — the desired half is what we scale from. */
function desiredReplicas(row: DeploymentRow): number {
  const desired = Number(row.ready.split("/")[1]);
  return Number.isFinite(desired) ? desired : row.available;
}

async function postAction(
  connectionId: string,
  row: DeploymentRow,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `/api/kubernetes/${connectionId}/deployments/${encodeURIComponent(
      row.namespace,
    )}/${encodeURIComponent(row.name)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || `request failed (${res.status})`);
  }
}

/** Shared chrome so both dialogs read as one family with ConfirmOverlay. */
function Shell({
  tone,
  title,
  children,
  error,
  onClose,
  action,
}: {
  tone: "amber" | "red";
  title: string;
  children: React.ReactNode;
  error: string | null;
  onClose: () => void;
  action: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div
        className={cn(
          "relative z-10 w-full max-w-md rounded-lg border bg-popover shadow-2xl overflow-hidden",
          tone === "red" ? "border-red-500/30" : "border-amber-500/30",
        )}
      >
        <div
          className={cn(
            "px-5 py-3 border-b border-border/60 font-mono flex items-center gap-2",
            tone === "red" ? "bg-red-500/5" : "bg-amber-500/5",
          )}
        >
          <span
            className={cn(
              "uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded",
              tone === "red"
                ? "bg-red-500/15 text-red-700 dark:text-red-300"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
            )}
          >
            {tone === "red" ? "rollout" : "scale"}
          </span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="px-5 py-4 text-sm text-foreground/85 leading-relaxed space-y-3">
          {children}
          {error ? (
            <span role="alert" className="block font-mono text-xs text-destructive">
              {error}
            </span>
          ) : null}
        </div>
        <div className="px-5 py-3 border-t border-border/60 bg-muted/30 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border/60 px-3 py-1.5 text-xs font-mono hover:bg-foreground/5"
          >
            cancel
          </button>
          {action}
        </div>
      </div>
    </div>
  );
}

export function ScaleDialog({ connectionId, row, close, refresh }: Props) {
  const [replicas, setReplicas] = useState(() => desiredReplicas(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await postAction(connectionId, row, { action: "scale", replicas });
      refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tone="amber"
      title="Scale deployment"
      error={error}
      onClose={close}
      action={
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-mono"
        >
          {busy ? "scaling…" : "scale"}
        </button>
      }
    >
      <span className="block">
        <span className="font-mono text-foreground">
          {row.namespace}/{row.name}
        </span>{" "}
        currently reports <span className="font-mono">{row.ready}</span> ready.
      </span>
      <label className="flex items-center gap-3 font-mono text-xs">
        <span className="text-muted-foreground">replicas</span>
        <input
          type="number"
          min={0}
          value={replicas}
          onChange={(e) => setReplicas(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          className="w-24 rounded border border-border/60 bg-background px-2 py-1 outline-none focus:border-amber-500/60"
        />
      </label>
      {replicas === 0 ? (
        <span className="block text-xs text-amber-700 dark:text-amber-300">
          Scaling to zero stops every pod in this deployment.
        </span>
      ) : null}
    </Shell>
  );
}

export function RestartDialog({ connectionId, row, close, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await postAction(connectionId, row, { action: "restart" });
      refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tone="red"
      title="Restart deployment?"
      error={error}
      onClose={close}
      action={
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-mono"
        >
          {busy ? "restarting…" : `Restart ${row.name}`}
        </button>
      }
    >
      <span className="block">
        Rolls every pod of{" "}
        <span className="font-mono text-foreground">
          {row.namespace}/{row.name}
        </span>{" "}
        by stamping the restart annotation on its pod template — the same thing{" "}
        <span className="font-mono">kubectl rollout restart</span> does.
      </span>
    </Shell>
  );
}
