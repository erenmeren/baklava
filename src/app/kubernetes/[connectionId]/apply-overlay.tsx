"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";
import { ALL_NAMESPACES } from "@/lib/kubernetes/namespace";
import type { ApplyOutcome } from "@/lib/connections/kubernetes/apply";
import { ConfirmOverlay } from "./confirm-overlay";

interface Props {
  connectionId: string;
  /** Current `?ns=`; the default for namespaced objects that name none. */
  namespace: string;
  onClose: () => void;
}

const TEMPLATE = `apiVersion: v1
kind: ConfigMap
metadata:
  name: example
data:
  key: value
`;

type Mode = { dryRun: boolean; force: boolean };

/**
 * "New / Apply YAML": paste one or more manifests (`---`), Preview runs a
 * server-side apply with dryRun=All and shows what would change per object,
 * Apply sends the same request for real. Field-manager conflicts offer a
 * force apply behind the confirm overlay.
 */
export function ApplyOverlay({ connectionId, namespace, onClose }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ApplyOutcome[] | null>(null);
  // The text + mode the shown results belong to; Apply needs a fresh preview.
  const [shown, setShown] = useState<{ text: string; dryRun: boolean } | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ns = namespace === ALL_NAMESPACES ? undefined : namespace;
  const fresh = shown?.text === value;
  const previewed = fresh && shown?.dryRun === true && !!results;
  const failed = results?.some((r) => r.action === "error") ?? false;
  const conflicted = results?.some((r) => r.action === "conflict") ?? false;
  const canApply = previewed && !failed && !conflicted && !busy;
  const canForce = previewed && conflicted && !failed && !busy;

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(mode: Mode) {
    if (busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    const text = value;
    try {
      const res = await fetch(`/api/kubernetes/${connectionId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yaml: text, namespace: ns, ...mode }),
        signal: ac.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: ApplyOutcome[];
        error?: string;
      };
      if (!res.ok || !data.results) throw new Error(data.error || `request failed (${res.status})`);
      setResults(data.results);
      setShown({ text, dryRun: mode.dryRun });
      if (!mode.dryRun) router.refresh();
    } catch (err) {
      if (ac.signal.aborted) return;
      setResults(null);
      setShown(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  const preview = () => run({ dryRun: true, force: false });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (confirmForce) return; // the confirm overlay owns Escape
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        preview();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const extensions = useMemo(
    () => [
      EditorView.theme({
        "&": { fontSize: "12.5px", height: "100%" },
        ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), monospace" },
      }),
    ],
    [],
  );

  const conflicts = results?.filter((r) => r.action === "conflict") ?? [];

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px]" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label="Apply YAML"
        className="absolute inset-x-4 inset-y-8 lg:inset-x-16 lg:inset-y-12 bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 font-mono gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              apply
            </span>
            <span className="text-sm font-medium">New / Apply YAML</span>
            <span className="text-[10px] ml-2 text-muted-foreground">
              default ns{" "}
              <span className="text-foreground">{ns ?? "(kubeconfig default)"}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <kbd className="hidden md:inline text-[10px] text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
              ⌘↵ preview
            </kbd>
            <button
              onClick={preview}
              disabled={busy}
              className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {busy ? "working…" : "preview"}
            </button>
            {canForce ? (
              <button
                onClick={() => setConfirmForce(true)}
                className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300 hover:bg-red-500/20"
              >
                force apply…
              </button>
            ) : (
              <button
                onClick={() => run({ dryRun: false, force: false })}
                disabled={!canApply}
                title={canApply ? undefined : "Preview the current YAML first"}
                className={cn(
                  "rounded border px-2 py-1 text-xs transition-colors",
                  canApply
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                    : "border-border/60 text-muted-foreground cursor-not-allowed",
                )}
              >
                apply
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">
              esc
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-rows-2 lg:grid-rows-1 lg:grid-cols-2">
          <div className="min-h-0 overflow-hidden bg-zinc-950 border-b lg:border-b-0 lg:border-r border-border/60">
            <CodeMirror
              value={value}
              onChange={setValue}
              extensions={extensions}
              theme="dark"
              height="100%"
              className="h-full"
              autoFocus
              aria-label="YAML manifests"
            />
          </div>
          <div className="min-h-0 overflow-auto p-3 font-mono text-xs space-y-3">
            {error ? (
              <pre role="alert" className="text-destructive whitespace-pre-wrap break-words border border-red-500/30 bg-red-500/10 rounded p-3">
                {error}
              </pre>
            ) : null}
            {!results && !error ? (
              <p className="text-muted-foreground">
                Paste one or more manifests separated by <code>---</code>, then preview. Preview is a
                server-side dry run: nothing changes until you apply.
              </p>
            ) : null}
            {results ? (
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {shown?.dryRun ? "dry run" : "applied"}
                {!fresh ? " · yaml changed since — preview again" : ""}
              </div>
            ) : null}
            {results?.map((r, i) => <OutcomeCard key={i} r={r} />)}
          </div>
        </div>
      </div>

      {confirmForce ? (
        <ConfirmOverlay
          title="Force apply"
          confirmLabel="force apply"
          onClose={() => setConfirmForce(false)}
          onConfirm={() => {
            setConfirmForce(false);
            run({ dryRun: false, force: true });
          }}
          body={
            <div className="space-y-2">
              <p>
                Take ownership of these fields from their current field managers. The controllers or
                tools that own them may fight back or overwrite them again.
              </p>
              <ul className="font-mono text-xs space-y-1 max-h-40 overflow-auto">
                {conflicts.flatMap((r) =>
                  (r.conflicts ?? []).map((c, j) => (
                    <li key={`${r.kind}/${r.name}/${j}`}>
                      {r.kind}/{r.name} <span className="text-foreground">{c.field ?? ""}</span>{" "}
                      <span className="text-muted-foreground">{c.message}</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          }
        />
      ) : null}
    </div>
  );
}

const ACTION_STYLE: Record<ApplyOutcome["action"], string> = {
  created: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  configured: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  unchanged: "bg-zinc-500/15 text-muted-foreground",
  conflict: "bg-red-500/15 text-red-700 dark:text-red-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

function OutcomeCard({ r }: { r: ApplyOutcome }) {
  const target = r.namespace ? `${r.namespace}/${r.name}` : r.name;
  return (
    <div className="rounded border border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
        <span className={cn("uppercase tracking-[0.18em] text-[9px] px-1.5 py-0.5 rounded", ACTION_STYLE[r.action])}>
          {r.action}
        </span>
        <span className="text-muted-foreground">{r.kind}</span>
        <span className="text-foreground truncate">{target}</span>
      </div>
      {r.action === "conflict" ? (
        <ul className="px-3 py-2 space-y-1">
          {(r.conflicts ?? []).map((c, i) => (
            <li key={i}>
              <span className="text-foreground">{c.field ?? "(field)"}</span>{" "}
              <span className="text-muted-foreground">{c.message}</span>
            </li>
          ))}
        </ul>
      ) : r.action === "error" ? (
        <pre className="px-3 py-2 text-destructive whitespace-pre-wrap break-words">{r.error}</pre>
      ) : r.diff ? (
        <pre className="px-0 py-1 overflow-x-auto bg-zinc-950 text-zinc-300 text-[11.5px] leading-[1.5]">
          {r.diff.split("\n").map((line, i) => (
            <div
              key={i}
              className={cn(
                "px-3",
                line.startsWith("+") && "bg-emerald-500/10 text-emerald-300",
                line.startsWith("-") && "bg-red-500/10 text-red-300",
                line.startsWith("@@") && "text-cyan-400",
              )}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      ) : null}
    </div>
  );
}
