"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  kind: string;
  namespace?: string;
  name: string;
  onClose: () => void;
}

type FlashKind = "saved" | "discarded" | "error";

/**
 * Real YAML editor. Loads the resource via
 *   GET  /api/kubernetes/[id]/yaml/[kind]/[name]?namespace=…
 * and saves via
 *   PUT  /api/kubernetes/[id]/yaml/[kind]/[name]?namespace=…
 * which routes to KubernetesObjectApi.replace under the hood. Server-managed
 * fields (managedFields, resourceVersion, status, …) are stripped before we
 * hand the buffer to the user.
 */
export function EditOverlay({ connectionId, kind, namespace, name, onClose }: Props) {
  const [initial, setInitial] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: FlashKind; text: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty = initial !== null && value !== initial;
  const target = namespace ? `${namespace}/${name}` : name;
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
  const url = `/api/kubernetes/${connectionId}/yaml/${encodeURIComponent(
    kind,
  )}/${encodeURIComponent(name)}${qs}`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(url);
        const data = (await res.json()) as { yaml?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || data.error) {
          throw new Error(data.error || `read failed (${res.status})`);
        }
        setInitial(data.yaml ?? "");
        setValue(data.yaml ?? "");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!loading) taRef.current?.focus();
  }, [loading]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (dirty) discard();
        else onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, value, loading]);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yaml: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `save failed (${res.status})`);
      }
      setInitial(value);
      setFlash({ kind: "saved", text: `✓ ${target} applied` });
      setTimeout(onClose, 700);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setFlash({ kind: "error", text: msg });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setFlash({ kind: "discarded", text: "discarded changes" });
    setTimeout(onClose, 300);
  }

  const lineCount = value.split("\n").length;
  const charCount = value.length;

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-background/55 backdrop-blur-[2px]"
        onMouseDown={() => (dirty ? discard() : onClose())}
      />
      <div className="absolute inset-x-4 inset-y-8 lg:inset-x-16 lg:inset-y-12 bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 font-mono gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
              edit
            </span>
            <span className="text-sm font-medium truncate">{target}</span>
            <span className="text-[10px] ml-2 uppercase tracking-[0.18em] text-muted-foreground">
              {kind}
            </span>
            {loading ? (
              <span className="text-[10px] text-muted-foreground italic ml-2">
                loading…
              </span>
            ) : dirty ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] ml-2 text-amber-600 dark:text-amber-400">
                <span className="size-1.5 rounded-full bg-amber-500" />
                modified
              </span>
            ) : (
              <span className="text-[10px] ml-2 text-muted-foreground">pristine</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <kbd className="hidden md:inline text-[10px] text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
              ⌘S save
            </kbd>
            <button
              onClick={discard}
              className="rounded border border-border/60 px-2 py-1 text-xs hover:bg-foreground/5"
            >
              discard
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className={cn(
                "rounded border px-2 py-1 text-xs transition-colors",
                dirty && !saving
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                  : "border-border/60 text-muted-foreground cursor-not-allowed",
              )}
            >
              {saving ? "saving…" : "save"}
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              esc
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative bg-zinc-950">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-500 font-mono text-xs">
              fetching {target}…
            </div>
          ) : initial === null && errorMsg ? (
            <div className="absolute inset-0 flex items-start justify-center p-6 overflow-auto">
              <pre className="text-red-400 text-xs whitespace-pre-wrap break-words max-w-2xl border border-red-500/30 bg-red-500/10 rounded p-3">
                {errorMsg}
              </pre>
            </div>
          ) : (
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              className="w-full h-full bg-zinc-950 text-zinc-100 font-mono text-[12.5px] leading-[1.6] px-4 py-3 outline-none resize-none caret-amber-400"
            />
          )}
          {flash ? (
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 px-4 py-2 text-xs font-mono border-t",
                flash.kind === "saved" &&
                  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
                flash.kind === "discarded" &&
                  "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
                flash.kind === "error" &&
                  "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 whitespace-pre-wrap",
              )}
            >
              {flash.text}
            </div>
          ) : null}
        </div>
        <div className="border-t border-border/60 bg-muted/30 px-4 py-1.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              lines{" "}
              <span className="text-foreground tabular-nums">{lineCount}</span>
            </span>
            <span>
              chars{" "}
              <span className="text-foreground tabular-nums">{charCount}</span>
            </span>
            <span>yaml · utf-8</span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              <kbd className="border border-border/60 rounded px-1 mr-1">esc</kbd>
              cancel
            </span>
            <span>
              <kbd className="border border-border/60 rounded px-1 mr-1">⌘S</kbd>
              save
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
