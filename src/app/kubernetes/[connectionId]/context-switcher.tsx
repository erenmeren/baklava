"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  current: string;
  /** Context *names* from the kubeconfig — the kubeconfig itself never leaves the server. */
  contexts: string[];
  /** `context` is a target key: only the owner or an admin may change it. */
  canSwitch: boolean;
}

/**
 * The cluster context in the workspace strip, as a dropdown of the kubeconfig's
 * contexts. Switching PATCHes the connection's `context`; the client bundle is
 * keyed on it, so the next server render talks to the new context.
 */
export function ContextSwitcher({ connectionId, current, contexts, canSwitch }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const disabled = !canSwitch || contexts.length < 2 || busy;
  const reason = !canSwitch
    ? "Only the connection's owner or an admin can switch context"
    : contexts.length < 2
      ? "The kubeconfig has only one context"
      : "Switch kubeconfig context";

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  async function switchTo(name: string) {
    setOpen(false);
    if (name === current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(connectionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { context: name } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref} title={error ?? reason}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label={`context ${current}`}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1 text-foreground",
          disabled ? "cursor-default" : "hover:bg-foreground/5",
          error && "text-red-600 dark:text-red-400",
        )}
      >
        {busy ? "switching…" : current}
        {contexts.length > 1 ? <span className="opacity-60">▾</span> : null}
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 min-w-[200px] rounded-md border border-border/70 bg-popover py-1 font-mono text-xs shadow-lg shadow-black/20">
          {contexts.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void switchTo(name)}
              className={cn(
                "block w-full px-3 py-1.5 text-left hover:bg-foreground/5",
                name === current && "text-cyan-600 dark:text-cyan-400",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
