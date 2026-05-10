"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileText,
  Home,
  Table as TableIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab =
  | { kind: "overview" }
  | { kind: "table"; db: string; schema: string; name: string }
  | { kind: "query"; db: string };

interface Props {
  connectionId: string;
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
    case "table":
      return `t:${t.db}/${t.schema}/${t.name}`;
    case "query":
      return `q:${t.db}`;
  }
}

function tabHref(connectionId: string, t: Tab): string {
  switch (t.kind) {
    case "overview":
      return `/postgres/${connectionId}`;
    case "table":
      return `/postgres/${connectionId}/databases/${encodeURIComponent(t.db)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}`;
    case "query":
      return `/postgres/${connectionId}/databases/${encodeURIComponent(t.db)}/query`;
  }
}

function tabLabel(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "Overview";
    case "table":
      return `${t.schema}.${t.name}`;
    case "query":
      return `SQL · ${t.db}`;
  }
}

function tabFromPath(pathname: string, connectionId: string): Tab | null {
  const prefix = `/postgres/${connectionId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest === "/") return { kind: "overview" };
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
  // /databases/[db]/query
  const queryMatch = rest.match(/^\/databases\/([^/]+)\/query/);
  if (queryMatch) {
    return { kind: "query", db: decodeURIComponent(queryMatch[1]) };
  }
  return null;
}

export function PostgresTabs({ connectionId }: Props) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once.
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
                ) : (
                  <FileText className="size-3 shrink-0" />
                )
              }
              label={tabLabel(t)}
              showClose
              onClose={() => closeTab(k)}
            />
          );
        })}
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
}: {
  href: string;
  active: boolean;
  title: string;
  icon: React.ReactNode;
  label: string;
  showClose: boolean;
  onClose?: () => void;
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
    >
      <Link
        href={href}
        title={title}
        className={cn(
          "inline-flex items-center gap-1.5 pl-3 min-w-0",
          showClose ? "pr-1" : "pr-3",
          "text-[12px] font-mono whitespace-nowrap",
        )}
      >
        <span
          className={cn(
            "shrink-0 grid place-items-center transition-opacity",
            active ? "opacity-100" : "opacity-70 group-hover/pgtab:opacity-100",
          )}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </Link>
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
