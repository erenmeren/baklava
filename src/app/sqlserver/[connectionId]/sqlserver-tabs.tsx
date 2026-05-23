"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileCode,
  FileText,
  Home,
  Plus,
  Table as TableIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab =
  | { kind: "overview" }
  | { kind: "table"; db: string; schema: string; name: string }
  | { kind: "module"; db: string; schema: string; name: string }
  | { kind: "query"; db: string; queryId: string; title: string };

interface Props {
  connectionId: string;
  /** Default database used as the target for the "+ New query" button. */
  defaultDatabase: string;
}

function storageKey(connectionId: string) {
  return `baklava:mssql-tabs:${connectionId}`;
}

function loadTabs(connectionId: string): Tab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Tab[]) : [];
  } catch {
    return [];
  }
}

function saveTabs(connectionId: string, tabs: Tab[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(connectionId), JSON.stringify(tabs));
  } catch {
    // ignore
  }
}

function tabKey(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "overview";
    case "table":
      return `t:${t.db}/${t.schema}/${t.name}`;
    case "module":
      return `m:${t.db}/${t.schema}/${t.name}`;
    case "query":
      return `q:${t.db}/${t.queryId}`;
  }
}

function tabHref(connectionId: string, t: Tab): string {
  const base = `/sqlserver/${connectionId}`;
  switch (t.kind) {
    case "overview":
      return base;
    case "table":
      return `${base}/databases/${encodeURIComponent(t.db)}/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}`;
    case "module":
      return `${base}/databases/${encodeURIComponent(t.db)}/modules/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}`;
    case "query":
      return `${base}/databases/${encodeURIComponent(t.db)}/query/${t.queryId}`;
  }
}

function tabLabel(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "Overview";
    case "table":
    case "module":
      return `${t.schema}.${t.name}`;
    case "query":
      return t.title;
  }
}

function tabFromPath(pathname: string, connectionId: string): Tab | null {
  const prefix = `/sqlserver/${connectionId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest === "/") return { kind: "overview" };

  // /databases/[db]/tables/[schema]/[name]
  const tableMatch = rest.match(
    /^\/databases\/([^/]+)\/tables\/([^/]+)\/([^/]+)/,
  );
  if (tableMatch) {
    return {
      kind: "table",
      db: decodeURIComponent(tableMatch[1]),
      schema: decodeURIComponent(tableMatch[2]),
      name: decodeURIComponent(tableMatch[3]),
    };
  }
  // /databases/[db]/modules/[schema]/[name]
  const moduleMatch = rest.match(
    /^\/databases\/([^/]+)\/modules\/([^/]+)\/([^/]+)/,
  );
  if (moduleMatch) {
    return {
      kind: "module",
      db: decodeURIComponent(moduleMatch[1]),
      schema: decodeURIComponent(moduleMatch[2]),
      name: decodeURIComponent(moduleMatch[3]),
    };
  }
  // /databases/[db]/query/[queryId]
  const queryMatch = rest.match(/^\/databases\/([^/]+)\/query\/([^/]+)/);
  if (queryMatch) {
    return {
      kind: "query",
      db: decodeURIComponent(queryMatch[1]),
      queryId: queryMatch[2],
      title: "",
    };
  }
  return null;
}

export function SqlServerTabs({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Tab being renamed (by tabKey). Only query tabs are renamable.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const commitRename = useCallback((key: string, next: string) => {
    const trimmed = next.trim();
    setTabs((prev) =>
      prev.map((t) => {
        if (tabKey(t) !== key || t.kind !== "query") return t;
        return { ...t, title: trimmed || t.title };
      }),
    );
    setEditingKey(null);
  }, []);

  useEffect(() => {
    setTabs(loadTabs(connectionId));
    setHydrated(true);
  }, [connectionId]);

  useEffect(() => {
    if (hydrated) saveTabs(connectionId, tabs);
  }, [tabs, hydrated, connectionId]);

  const activeTab = useMemo(
    () => tabFromPath(pathname, connectionId),
    [pathname, connectionId],
  );
  const activeKey = activeTab ? tabKey(activeTab) : null;

  // Auto-add the active tab if it's not already in the strip.
  useEffect(() => {
    if (!hydrated || !activeTab) return;
    setTabs((prev) => {
      const k = tabKey(activeTab);
      if (prev.some((t) => tabKey(t) === k)) return prev;
      if (activeTab.kind === "query") {
        const existing = prev.filter((t) => t.kind === "query").length;
        return [...prev, { ...activeTab, title: `query ${existing + 1}` }];
      }
      return [...prev, activeTab];
    });
  }, [activeTab, hydrated]);

  const closeTab = useCallback(
    (key: string) => {
      const idx = tabs.findIndex((t) => tabKey(t) === key);
      if (idx < 0) return;
      const next = tabs.filter((_, i) => i !== idx);
      setTabs(next);
      if (key === activeKey) {
        const fallback = next[idx - 1] ?? next[idx] ?? null;
        router.push(
          fallback ? tabHref(connectionId, fallback) : `/sqlserver/${connectionId}`,
        );
      }
    },
    [tabs, activeKey, router, connectionId],
  );

  if (!hydrated) {
    return (
      <div className="h-9 border-b border-border/60 bg-background/80" aria-hidden />
    );
  }

  return (
    <div
      className="flex items-stretch h-9 border-b border-border/60 bg-muted/30 overflow-x-auto no-scrollbar"
      role="tablist"
      aria-label="Open objects and editors"
    >
      <Tab
        href={`/sqlserver/${connectionId}`}
        active={activeKey === "overview"}
        title="Overview"
        icon={<Home className="size-3 shrink-0" />}
        label="Overview"
        showClose={false}
      />
      {tabs.length > 0 ? (
        <span className="self-center mx-1 h-3.5 w-px bg-border/60" aria-hidden />
      ) : null}
      {tabs
        .filter((t) => t.kind !== "overview")
        .map((t) => {
          const k = tabKey(t);
          const active = k === activeKey;
          return (
            <Tab
              key={k}
              href={tabHref(connectionId, t)}
              active={active}
              title={tabLabel(t)}
              icon={
                t.kind === "table" ? (
                  <TableIcon className="size-3 shrink-0" />
                ) : t.kind === "module" ? (
                  <FileCode className="size-3 shrink-0" />
                ) : (
                  <FileText className="size-3 shrink-0" />
                )
              }
              label={tabLabel(t)}
              showClose
              onClose={() => closeTab(k)}
              editable={t.kind === "query"}
              editing={editingKey === k}
              onStartEdit={() => setEditingKey(k)}
              onCommit={(text) => commitRename(k, text)}
              onCancel={() => setEditingKey(null)}
            />
          );
        })}

      <Link
        href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query`}
        title="Open a new query tab"
        aria-label="New query"
        className={cn(
          "group/newq relative inline-flex items-center gap-2 h-7 px-3 ml-2 mr-1 self-center shrink-0",
          "rounded-full border border-brand/30 bg-brand/[0.04]",
          "text-[12px] font-mono tracking-tight whitespace-nowrap text-brand/85",
          "transition-all duration-200 ease-out",
          "hover:bg-brand/10 hover:border-brand/60 hover:text-brand",
          "hover:shadow-[0_0_14px_-3px_var(--brand)]",
          "active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-4 rounded-full grid place-items-center shrink-0",
            "bg-brand/15 border border-brand/40",
            "transition-transform duration-200 ease-out",
            "group-hover/newq:rotate-90 group-hover/newq:bg-brand/25",
          )}
        >
          <Plus className="size-2.5" strokeWidth={2.8} />
        </span>
        <span>New query</span>
      </Link>
    </div>
  );
}

function Tab({
  href,
  active,
  title,
  icon,
  label,
  showClose,
  onClose,
  editable = false,
  editing = false,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  href: string;
  active: boolean;
  title: string;
  icon: React.ReactNode;
  label: string;
  showClose: boolean;
  onClose?: () => void;
  /** When true, double-clicking the tab enters inline rename mode. */
  editable?: boolean;
  editing?: boolean;
  onStartEdit?: () => void;
  onCommit?: (text: string) => void;
  onCancel?: () => void;
}) {
  return (
    <div
      className={cn(
        "group/mstab relative inline-flex items-stretch h-9 max-w-[260px] min-w-0",
        "transition-colors",
        active
          ? "text-foreground bg-background"
          : "text-muted-foreground hover:text-foreground hover:bg-background/40",
      )}
      role="tab"
      aria-selected={active}
      onMouseDown={(e) => {
        if (e.button === 1 && onClose) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && onClose) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onCommit?.(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit?.(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel?.();
            }
          }}
          className={cn(
            "inline-flex h-7 self-center min-w-[60px] max-w-[220px] mx-1 px-1.5",
            "rounded-sm text-[12px] font-mono text-foreground bg-transparent",
            "border-b border-brand outline-none",
          )}
          aria-label="Rename tab"
        />
      ) : (
        <Link
          href={href}
          title={editable ? `${title} · double-click to rename` : title}
          onDoubleClick={(e) => {
            if (!editable) return;
            e.preventDefault();
            onStartEdit?.();
          }}
          className={cn(
            "inline-flex items-center gap-1.5 pl-3 min-w-0",
            showClose ? "pr-1" : "pr-3",
            "text-[12px] font-mono whitespace-nowrap",
          )}
        >
          <span
            className={cn(
              "shrink-0 grid place-items-center transition-opacity",
              active ? "opacity-100" : "opacity-70 group-hover/mstab:opacity-100",
            )}
          >
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </Link>
      )}
      {showClose && onClose ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${label}`}
          title="Close tab"
          className={cn(
            "self-center mx-1 size-4 grid place-items-center rounded outline-none shrink-0",
            "text-muted-foreground/0 group-hover/mstab:text-muted-foreground/70 focus-visible:text-foreground",
            active && "text-muted-foreground/60",
            "hover:!text-foreground hover:bg-accent/70 transition-colors",
          )}
        >
          <X className="size-3" strokeWidth={2.4} />
        </button>
      ) : null}
      {active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-2 right-2 -bottom-px h-[2px] rounded-t-sm bg-brand"
        />
      ) : null}
    </div>
  );
}
