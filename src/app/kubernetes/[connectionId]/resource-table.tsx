"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useK8s } from "./k8s-context";
import { DetailOverlay } from "./detail-overlay";
import { LogOverlay } from "./log-overlay";
import { ConfirmOverlay } from "./confirm-overlay";
import { ShellOverlay } from "./shell-overlay";
import { EditOverlay } from "./edit-overlay";

export interface Column<T> {
  /** Header label. Rendered uppercase in the head row. */
  label: string;
  /** Width as a Tailwind class (e.g. "w-32", "w-[80px]") or `null` for flex-1. */
  width: string | null;
  /** Right-align numeric columns. */
  align?: "left" | "right";
  /** Cell renderer. Selected highlight is overlaid by the row wrapper. */
  cell: (row: T) => React.ReactNode;
  /** Raw value for sorting / filtering. */
  value: (row: T) => string | number;
  /** Optional cell-level class for the data cell (mono variants, etc.). */
  className?: string;
}

/**
 * A resource-specific action (scale, restart, cordon…) contributed by a view.
 * The table owns the key binding and the open/close state so the action can't
 * fight with the built-in overlays; the view owns whatever it renders.
 */
export interface RowAction<T> {
  /** Key that opens it. Capitals are deliberately harder to hit. */
  key: string;
  /** Label shown in the hotkey hints. */
  label: string;
  danger?: boolean;
  render: (args: {
    row: T;
    close: () => void;
    /** Re-run the server components behind the table after a mutation. */
    refresh: () => void;
  }) => React.ReactNode;
}

export interface ResourceTableProps<T extends { name: string; namespace?: string }> {
  /** Short resource label, e.g. "Pods" — shown in the footer counter. */
  resource: string;
  /** Headline single-letter the table uses in toast strings, e.g. "po". */
  shortName?: string;
  /**
   * URL-friendly singular kind, e.g. "pod" / "deployment". Used to route
   * the YAML edit endpoint. Required when `actions.edit` is true.
   */
  kind?: string;
  rows: T[];
  columns: Column<T>[];
  /** Optional resource-specific action enablement (e.g. logs only on pods). */
  actions?: {
    logs?: boolean;
    shell?: boolean;
    edit?: boolean;
    delete?: boolean;
  };
  /** Resource-specific actions contributed by the view (scale, restart, …). */
  rowActions?: RowAction<T>[];
  /** Render the right-hand "describe" YAML for the selected row. */
  describeYaml?: (row: T) => string;
}

/**
 * Shared dense table used by every k8s resource page. Mirrors the k9s
 * default skin:
 *   - JetBrains Mono everywhere
 *   - Magenta-pink selected row marker (left border)
 *   - Cyan-tinted selected row background
 *   - Status-colored "STATUS" column (handled by callers via cell renderers)
 *   - j/k navigation, g/G jump-to-edge, Enter to describe, l for logs,
 *     D to delete (capital, deliberately scary)
 */
export function ResourceTable<T extends { name: string; namespace?: string }>({
  resource,
  shortName,
  kind,
  rows,
  columns,
  actions = {},
  rowActions,
  describeYaml,
}: ResourceTableProps<T>) {
  const k8s = useK8s();
  const router = useRouter();
  // `?select=<name>` lets the command palette (and any other deep link) land
  // on a specific row — the workspace has no per-object route to point at.
  const selectName = useSearchParams().get("select");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState(0);
  const [overlay, setOverlay] = useState<
    null | { kind: "describe" | "yaml"; row: T }
    | { kind: "logs"; row: T }
    | { kind: "shell"; row: T }
    | { kind: "edit"; row: T }
    | { kind: "delete"; row: T }
    | { kind: "action"; row: T; action: RowAction<T> }
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const closeDelete = useCallback(() => {
    setOverlay(null);
    setDeleteError(null);
  }, []);

  /**
   * Delete the row through the same YAML endpoint the edit overlay uses.
   * On success the route is refreshed — the rows come from a server
   * component, so nothing else would take the deleted row off the screen.
   */
  const runDelete = useCallback(
    async (row: T) => {
      if (deleting) return;
      if (!kind) {
        setDeleteError("no kind configured for this table");
        return;
      }
      setDeleting(true);
      setDeleteError(null);
      const qs = row.namespace
        ? `?namespace=${encodeURIComponent(row.namespace)}`
        : "";
      const url = `/api/kubernetes/${k8s.connectionId}/yaml/${encodeURIComponent(
        kind,
      )}/${encodeURIComponent(row.name)}${qs}`;
      try {
        const res = await fetch(url, { method: "DELETE" });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok || data.error) {
          throw new Error(data.error || `delete failed (${res.status})`);
        }
        setOverlay(null);
        router.refresh();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeleting(false);
      }
    },
    [deleting, kind, k8s.connectionId, router],
  );

  // Filter by namespace + free-text filter from the shell.
  const visibleRows = useMemo(() => {
    const f = k8s.filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (k8s.namespace !== "*" && r.namespace && r.namespace !== k8s.namespace) {
        return false;
      }
      if (!f) return true;
      // Match against every column's underlying value — that way you can
      // filter by status, ip, age string, etc.
      return columns.some((c) =>
        String(c.value(r)).toLowerCase().includes(f),
      );
    });
  }, [rows, columns, k8s.namespace, k8s.filter]);

  // Honour ?select= once the rows are in: the palette navigates here with a
  // name, not an index.
  useEffect(() => {
    if (!selectName) return;
    const i = visibleRows.findIndex((r) => r.name === selectName);
    if (i >= 0) setSelected(i);
  }, [selectName, visibleRows]);

  // Clamp selection when the filtered list shrinks.
  useEffect(() => {
    if (selected >= visibleRows.length) setSelected(Math.max(0, visibleRows.length - 1));
  }, [visibleRows.length, selected]);

  const scrollToSelection = useCallback(() => {
    const el = rowRefs.current[selected];
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Keyboard navigation.
  useEffect(() => {
    function isTyping() {
      const a = document.activeElement;
      if (!a) return false;
      const tag = a.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if ((a as HTMLElement).isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (overlay) return; // overlays handle their own keys
      if (isTyping()) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) =>
          visibleRows.length === 0 ? 0 : Math.min(s + 1, visibleRows.length - 1),
        );
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === "g") {
        e.preventDefault();
        setSelected(0);
        return;
      }
      if (e.key === "G") {
        e.preventDefault();
        setSelected(Math.max(0, visibleRows.length - 1));
        return;
      }
      const row = visibleRows[selected];
      if (!row) return;

      if (e.key === "Enter") {
        e.preventDefault();
        setOverlay({ kind: "describe", row });
        return;
      }
      if (e.key === "y") {
        e.preventDefault();
        setOverlay({ kind: "yaml", row });
        return;
      }
      if (e.key === "l" && actions.logs) {
        e.preventDefault();
        setOverlay({ kind: "logs", row });
        return;
      }
      if (e.key === "s" && actions.shell) {
        e.preventDefault();
        setOverlay({ kind: "shell", row });
        return;
      }
      if (e.key === "e" && actions.edit) {
        e.preventDefault();
        setOverlay({ kind: "edit", row });
        return;
      }
      const custom = rowActions?.find((a) => a.key === e.key);
      if (custom) {
        e.preventDefault();
        setOverlay({ kind: "action", row, action: custom });
        return;
      }
      if (e.key === "D" && actions.delete) {
        e.preventDefault();
        setOverlay({ kind: "delete", row });
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, visibleRows, selected, actions.logs, actions.shell, actions.edit, actions.delete, rowActions]);

  useEffect(() => {
    scrollToSelection();
  }, [scrollToSelection]);

  // Compute the grid-template-columns string from the column defs.
  const gridTemplate = columns
    .map((c) => c.width ?? "minmax(0, 1fr)")
    // Tailwind w-* utilities don't compose cleanly into grid-template, so we
    // emit either a raw token (when `width` is something like "minmax(...)"
    // or "200px") or rely on tailwind classes on individual cells below.
    // For simplicity all `width: string` inputs are treated as opaque tokens
    // that look like "200px" / "12rem" / "1fr".
    .map((w) => (w === "minmax(0, 1fr)" ? w : w.startsWith("w-") ? toToken(w) : w))
    .join(" ");

  function toToken(twWidth: string): string {
    // tailwind w-32 → 8rem; w-[120px] → 120px. Use CSS calc for safety.
    if (twWidth.startsWith("w-[") && twWidth.endsWith("]")) {
      return twWidth.slice(3, -1);
    }
    const map: Record<string, string> = {
      "w-12": "3rem",
      "w-16": "4rem",
      "w-20": "5rem",
      "w-24": "6rem",
      "w-28": "7rem",
      "w-32": "8rem",
      "w-40": "10rem",
      "w-48": "12rem",
      "w-56": "14rem",
      "w-64": "16rem",
      "w-72": "18rem",
      "w-80": "20rem",
      "w-96": "24rem",
    };
    return map[twWidth] ?? "auto";
  }

  const total = rows.length;
  const showing = visibleRows.length;

  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-[12.5px]">
      {/* Resource title + count */}
      <div className="px-4 py-2 flex items-center gap-3 border-b border-border/60 bg-background/40">
        <span className="text-foreground font-semibold tracking-tight text-sm">
          {resource}
        </span>
        <span className="text-cyan-600 dark:text-cyan-400 tabular-nums text-[11px]">
          [{showing}/{total}]
        </span>
        {k8s.namespace !== "*" ? (
          <span className="text-[10px] text-muted-foreground uppercase tracking-[0.22em]">
            ns · <span className="text-foreground">{k8s.namespace}</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground uppercase tracking-[0.22em]">
            ns · <span className="text-cyan-600 dark:text-cyan-400">all</span>
          </span>
        )}
        {k8s.filter ? (
          <span className="text-[10px] text-muted-foreground uppercase tracking-[0.22em] flex items-center gap-1">
            filter · <span className="text-foreground">{k8s.filter}</span>
            <button
              onClick={() => k8s.setFilter("")}
              className="ml-1 text-muted-foreground hover:text-foreground"
              title="clear filter"
            >
              ×
            </button>
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {shortName ? (
            <>
              :<span className="text-foreground">{shortName}</span>
            </>
          ) : null}
        </span>
      </div>

      {/* Header */}
      <div
        className="px-4 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60 bg-muted/30"
        style={{ display: "grid", gridTemplateColumns: gridTemplate, gap: "0.75rem" }}
      >
        {columns.map((c) => (
          <div
            key={c.label}
            className={cn(
              "truncate",
              c.align === "right" ? "text-right" : "text-left",
            )}
          >
            {c.label}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <div className="px-4 py-16 text-center text-muted-foreground text-xs">
            <div className="mb-1">no {resource.toLowerCase()} match the current filter</div>
            <div className="text-[10px] text-muted-foreground/70 uppercase tracking-[0.22em]">
              try{" "}
              <kbd className="px-1 border border-border/60 rounded">esc</kbd>{" "}
              to clear
            </div>
          </div>
        ) : (
          visibleRows.map((row, i) => {
            const isSel = i === selected;
            return (
              <button
                key={`${row.namespace ?? ""}/${row.name}`}
                ref={(el) => { rowRefs.current[i] = el; }}
                role="row"
                aria-selected={isSel}
                onClick={() => setSelected(i)}
                onDoubleClick={() => setOverlay({ kind: "describe", row })}
                className={cn(
                  "w-full text-left border-l-2 transition-colors",
                  isSel
                    ? "border-pink-500 bg-cyan-500/8 dark:bg-cyan-400/10 text-foreground"
                    : "border-transparent hover:bg-foreground/[0.035]",
                )}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  columnGap: "0.75rem",
                  padding: "0.3rem 1rem 0.3rem calc(1rem - 2px)",
                }}
              >
                {columns.map((c) => (
                  <div
                    key={c.label}
                    className={cn(
                      "truncate",
                      c.align === "right" ? "text-right tabular-nums" : "",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </div>
                ))}
              </button>
            );
          })
        )}
      </div>

      {/* Action hint row — k9s-style footer */}
      <div className="border-t border-border/60 bg-muted/30 px-4 py-1.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0 border border-border/60 rounded mr-1">
              ↵
            </kbd>
            describe
          </span>
          <span>
            <kbd className="px-1 py-0 border border-border/60 rounded mr-1">
              y
            </kbd>
            yaml
          </span>
          {actions.logs ? (
            <span>
              <kbd className="px-1 py-0 border border-border/60 rounded mr-1">
                l
              </kbd>
              logs
            </span>
          ) : null}
          {actions.shell ? (
            <span>
              <kbd className="px-1 py-0 border border-border/60 rounded mr-1">
                s
              </kbd>
              shell
            </span>
          ) : null}
          {actions.edit ? (
            <span>
              <kbd className="px-1 py-0 border border-border/60 rounded mr-1">
                e
              </kbd>
              edit
            </span>
          ) : null}
          {rowActions?.map((a) => (
            <span
              key={a.key}
              className={a.danger ? "text-red-600 dark:text-red-400" : undefined}
            >
              <kbd
                className={cn(
                  "px-1 py-0 rounded mr-1 border",
                  a.danger
                    ? "border-red-500/40 bg-red-500/10"
                    : "border-border/60",
                )}
              >
                {a.key}
              </kbd>
              {a.label}
            </span>
          ))}
          {actions.delete ? (
            <span className="text-red-600 dark:text-red-400">
              <kbd className="px-1 py-0 border border-red-500/40 bg-red-500/10 rounded mr-1">
                D
              </kbd>
              delete
            </span>
          ) : null}
        </div>
        <span>
          selected{" "}
          <span className="text-foreground tabular-nums">
            {showing === 0 ? 0 : selected + 1}/{showing}
          </span>
        </span>
      </div>

      {/* Overlays */}
      {overlay?.kind === "describe" || overlay?.kind === "yaml" ? (
        <DetailOverlay
          mode={overlay.kind}
          title={`${overlay.kind === "yaml" ? "YAML" : "Describe"}: ${overlay.row.namespace ? `${overlay.row.namespace}/` : ""}${overlay.row.name}`}
          content={
            describeYaml
              ? describeYaml(overlay.row)
              : defaultDescribe(overlay.row, columns)
          }
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === "logs" ? (
        <LogOverlay
          connectionId={k8s.connectionId}
          namespace={overlay.row.namespace ?? "default"}
          pod={overlay.row.name}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === "shell" ? (
        <ShellOverlay
          connectionId={k8s.connectionId}
          namespace={overlay.row.namespace ?? "default"}
          pod={overlay.row.name}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === "edit" && kind ? (
        <EditOverlay
          connectionId={k8s.connectionId}
          kind={kind}
          namespace={overlay.row.namespace}
          name={overlay.row.name}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === "action"
        ? overlay.action.render({
            row: overlay.row,
            close: () => setOverlay(null),
            refresh: () => router.refresh(),
          })
        : null}
      {overlay?.kind === "delete" ? (
        <ConfirmOverlay
          title={`Delete ${resource.toLowerCase().replace(/s$/, "")}?`}
          body={
            <>
              You&apos;re about to delete{" "}
              <span className="font-mono text-foreground">
                {overlay.row.namespace
                  ? `${overlay.row.namespace}/${overlay.row.name}`
                  : overlay.row.name}
              </span>
              . This action is irreversible.
              {deleteError ? (
                <span className="mt-3 block font-mono text-xs text-destructive" role="alert">
                  {deleteError}
                </span>
              ) : null}
            </>
          }
          confirmLabel={deleting ? "deleting…" : `Delete ${overlay.row.name}`}
          onClose={closeDelete}
          onConfirm={() => void runDelete(overlay.row)}
        />
      ) : null}
    </div>
  );
}

function defaultDescribe<T>(row: T, columns: Column<T>[]): string {
  // Format like `kubectl describe` — Key: Value pairs, indented.
  const r = row as Record<string, unknown>;
  const keys = [
    "namespace",
    "name",
    "status",
    "ready",
    "restarts",
    "ip",
    "node",
    "qos",
    "ageSeconds",
    "image",
    "selector",
    "type",
    "clusterIP",
    "externalIP",
    "ports",
    "dataKeys",
    "labels",
    "lastRestart",
  ];
  const lines: string[] = [];
  for (const k of keys) {
    if (r[k] === undefined) continue;
    lines.push(`${k.padEnd(14)}: ${r[k]}`);
  }
  if (lines.length === 0) {
    // Fallback: dump all columns.
    return columns
      .map((c) => `${c.label.padEnd(14)}: ${c.value(row)}`)
      .join("\n");
  }
  return lines.join("\n");
}
