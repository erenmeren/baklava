"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  FileCode,
  Hash,
  Home,
  Plus,
  Shield,
  Table as TableIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab =
  | { kind: "overview" }
  | { kind: "roles" }
  | { kind: "table"; db: string; schema: string; name: string }
  | {
      kind: "function";
      db: string;
      schema: string;
      name: string;
      args: string;
    }
  | { kind: "sequence"; db: string; schema: string; name: string }
  | { kind: "query"; db: string; queryId: string; title: string };

interface Props {
  connectionId: string;
  /** Default database used as the target for the "+ Query" button. */
  defaultDatabase: string;
}

function storageKey(connectionId: string) {
  return `baklava:pg-tabs:${connectionId}`;
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
    case "roles":
      return "roles";
    case "table":
      return `t:${t.db}/${t.schema}/${t.name}`;
    case "function":
      return `f:${t.db}/${t.schema}/${t.name}(${t.args})`;
    case "sequence":
      return `s:${t.db}/${t.schema}/${t.name}`;
    case "query":
      return `q:${t.db}/${t.queryId}`;
  }
}

function tabHref(connectionId: string, t: Tab): string {
  switch (t.kind) {
    case "overview":
      return `/postgres/${connectionId}`;
    case "roles":
      return `/postgres/${connectionId}/roles`;
    case "table":
      return `/postgres/${connectionId}/databases/${encodeURIComponent(t.db)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}`;
    case "function":
      return `/postgres/${connectionId}/databases/${encodeURIComponent(t.db)}/schemas/${encodeURIComponent(t.schema)}/functions/${encodeURIComponent(t.name)}?args=${encodeURIComponent(t.args)}`;
    case "sequence":
      return `/postgres/${connectionId}/databases/${encodeURIComponent(t.db)}/schemas/${encodeURIComponent(t.schema)}/sequences/${encodeURIComponent(t.name)}`;
    case "query":
      return `/postgres/${connectionId}/databases/${encodeURIComponent(t.db)}/query/${t.queryId}`;
  }
}

function tabLabel(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "Overview";
    case "roles":
      return "Roles";
    case "table":
      return `${t.schema}.${t.name}`;
    case "function":
      return `${t.schema}.${t.name}()`;
    case "sequence":
      return `${t.schema}.${t.name}`;
    case "query":
      return t.title;
  }
}

function tabFromPath(
  pathname: string,
  search: string,
  connectionId: string,
): Tab | null {
  const prefix = `/postgres/${connectionId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest === "/") return { kind: "overview" };
  if (rest === "/roles" || rest.startsWith("/roles")) return { kind: "roles" };
  // /databases/[db]/schemas/[schema]/tables/[name]
  const tableMatch = rest.match(
    /^\/databases\/([^/]+)\/schemas\/([^/]+)\/tables\/([^/]+)/,
  );
  if (tableMatch) {
    return {
      kind: "table",
      db: decodeURIComponent(tableMatch[1]),
      schema: decodeURIComponent(tableMatch[2]),
      name: decodeURIComponent(tableMatch[3]),
    };
  }
  // /databases/[db]/schemas/[schema]/functions/[name]?args=...
  const fnMatch = rest.match(
    /^\/databases\/([^/]+)\/schemas\/([^/]+)\/functions\/([^/]+)/,
  );
  if (fnMatch) {
    const args = new URLSearchParams(search).get("args") ?? "";
    return {
      kind: "function",
      db: decodeURIComponent(fnMatch[1]),
      schema: decodeURIComponent(fnMatch[2]),
      name: decodeURIComponent(fnMatch[3]),
      args,
    };
  }
  // /databases/[db]/schemas/[schema]/sequences/[name]
  const seqMatch = rest.match(
    /^\/databases\/([^/]+)\/schemas\/([^/]+)\/sequences\/([^/]+)/,
  );
  if (seqMatch) {
    return {
      kind: "sequence",
      db: decodeURIComponent(seqMatch[1]),
      schema: decodeURIComponent(seqMatch[2]),
      name: decodeURIComponent(seqMatch[3]),
    };
  }
  // /databases/[db]/query/[queryId]
  const queryMatch = rest.match(/^\/databases\/([^/]+)\/query\/([^/]+)/);
  if (queryMatch) {
    return {
      kind: "query",
      db: decodeURIComponent(queryMatch[1]),
      queryId: queryMatch[2],
      // title is filled in on auto-add (we need access to existing tabs to count).
      title: "",
    };
  }
  return null;
}

export function PostgresTabs({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const searchString = searchParams ? searchParams.toString() : "";
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

  // Hydrate from localStorage once.
  useEffect(() => {
    setTabs(loadTabs(connectionId));
    setHydrated(true);
  }, [connectionId]);

  useEffect(() => {
    if (hydrated) saveTabs(connectionId, tabs);
  }, [tabs, hydrated, connectionId]);

  const activeTab = useMemo(
    () => tabFromPath(pathname, searchString, connectionId),
    [pathname, searchString, connectionId],
  );
  const activeKey = activeTab ? tabKey(activeTab) : null;

  // Auto-add the active tab if it's not already in the strip.
  useEffect(() => {
    if (!hydrated || !activeTab) return;
    setTabs((prev) => {
      const k = tabKey(activeTab);
      if (prev.some((t) => tabKey(t) === k)) return prev;
      if (activeTab.kind === "query") {
        // Number this tab sequentially: count existing query tabs and add one.
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
        if (fallback) {
          router.push(tabHref(connectionId, fallback));
        } else {
          router.push(`/postgres/${connectionId}`);
        }
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
      aria-label="Open tables and editors"
    >
      <Tab
        href={`/postgres/${connectionId}`}
        active={activeKey === "overview"}
        title="Overview"
        icon={<Home className="size-3 shrink-0" />}
        label="Overview"
        showClose={false}
      />
      {tabs.length > 0 ? (
        <span
          className="self-center mx-1 h-3.5 w-px bg-border/60"
          aria-hidden
        />
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
                ) : t.kind === "roles" ? (
                  <Shield className="size-3 shrink-0" />
                ) : t.kind === "function" ? (
                  <FileCode className="size-3 shrink-0" />
                ) : t.kind === "sequence" ? (
                  <Hash className="size-3 shrink-0" />
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
        href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query`}
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
        "group/pgtab relative inline-flex items-stretch h-9 max-w-[260px] min-w-0",
        "transition-colors",
        active ? "text-foreground bg-background" : "text-muted-foreground hover:text-foreground hover:bg-background/40",
      )}
      role="tab"
      aria-selected={active}
      onMouseDown={(e) => {
        // Middle-click would otherwise open in a new browser tab. Suppress the
        // default and let onAuxClick handle the close. Skip while renaming so
        // a stray middle-click can't tear down the input.
        if (e.button === 1 && onClose && !editing) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && onClose && !editing) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {(() => {
        const rowClass = cn(
          "inline-flex items-center gap-1.5 pl-3 min-w-0",
          showClose && !editing ? "pr-1" : "pr-3",
          "text-[12px] font-mono whitespace-nowrap",
        );
        const iconNode = (
          <span
            className={cn(
              "shrink-0 grid place-items-center transition-opacity",
              active ? "opacity-100" : "opacity-70 group-hover/pgtab:opacity-100",
            )}
          >
            {icon}
          </span>
        );
        return editing ? (
          <div className={rowClass}>
            {iconNode}
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
              aria-label="Rename tab"
              className={cn(
                "h-6 min-w-[60px] max-w-[200px] px-1.5 [field-sizing:content]",
                "rounded-md border border-border/80 bg-background",
                "text-[12px] font-mono text-foreground caret-brand",
                "outline-none transition-shadow",
                "focus:border-brand focus:ring-2 focus:ring-brand/25",
              )}
            />
          </div>
        ) : (
          <Link
            href={href}
            title={editable ? `${title} · double-click to rename` : title}
            onDoubleClick={(e) => {
              if (!editable) return;
              e.preventDefault();
              onStartEdit?.();
            }}
            className={rowClass}
          >
            {iconNode}
            <span className="truncate">{label}</span>
          </Link>
        );
      })()}
      {showClose && onClose && !editing ? (
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
            "text-muted-foreground/0 group-hover/pgtab:text-muted-foreground/70 focus-visible:text-foreground",
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
