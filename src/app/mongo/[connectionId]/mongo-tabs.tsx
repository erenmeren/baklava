"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Database,
  FileText,
  Home,
  Network,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTableTabs } from "@/components/workspace/use-table-tabs";

type Tab =
  | { kind: "overview" }
  | { kind: "database"; db: string }
  | { kind: "collection"; db: string; name: string }
  | { kind: "current-op" }
  | { kind: "repl-status" }
  | { kind: "server-status" };

interface Props {
  connectionId: string;
}

function tabKey(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "overview";
    case "database":
      return `d:${t.db}`;
    case "collection":
      return `c:${t.db}/${t.name}`;
    case "current-op":
      return "current-op";
    case "repl-status":
      return "repl-status";
    case "server-status":
      return "server-status";
  }
}

function tabHref(connectionId: string, t: Tab): string {
  switch (t.kind) {
    case "overview":
      return `/mongo/${connectionId}/databases`;
    case "database":
      return `/mongo/${connectionId}/databases/${encodeURIComponent(t.db)}`;
    case "collection":
      return `/mongo/${connectionId}/databases/${encodeURIComponent(t.db)}/${encodeURIComponent(t.name)}`;
    case "current-op":
      return `/mongo/${connectionId}/current-op`;
    case "repl-status":
      return `/mongo/${connectionId}/repl-status`;
    case "server-status":
      return `/mongo/${connectionId}/server-status`;
  }
}

function tabLabel(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "Overview";
    case "database":
      return t.db;
    case "collection":
      return `${t.db}.${t.name}`;
    case "current-op":
      return "Current ops";
    case "repl-status":
      return "Replica set";
    case "server-status":
      return "Server status";
  }
}

function tabFromPath(pathname: string, connectionId: string): Tab | null {
  const prefix = `/mongo/${connectionId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest === "/" || rest === "/databases") {
    return { kind: "overview" };
  }
  if (rest === "/current-op" || rest.startsWith("/current-op")) {
    return { kind: "current-op" };
  }
  if (rest === "/repl-status" || rest.startsWith("/repl-status")) {
    return { kind: "repl-status" };
  }
  if (rest === "/server-status" || rest.startsWith("/server-status")) {
    return { kind: "server-status" };
  }
  // /databases/[db]/[coll]
  const collMatch = rest.match(/^\/databases\/([^/]+)\/([^/]+)/);
  if (collMatch) {
    return {
      kind: "collection",
      db: decodeURIComponent(collMatch[1]),
      name: decodeURIComponent(collMatch[2]),
    };
  }
  // /databases/[db]
  const dbMatch = rest.match(/^\/databases\/([^/]+)/);
  if (dbMatch) {
    return { kind: "database", db: decodeURIComponent(dbMatch[1]) };
  }
  return null;
}

export function MongoTabs({ connectionId }: Props) {
  const pathname = usePathname() ?? "";

  const activeTab = useMemo(
    () => tabFromPath(pathname, connectionId),
    [pathname, connectionId],
  );

  const { tabs, hydrated, activeKey, closeTab } = useTableTabs<Tab>({
    storageKey: `baklava:mongo-tabs:${connectionId}`,
    activeTab,
    key: tabKey,
    href: (t) => tabHref(connectionId, t),
    homeHref: `/mongo/${connectionId}/databases`,
  });

  if (!hydrated) {
    return (
      <div className="h-9 border-b border-border/60 bg-background/80" aria-hidden />
    );
  }

  return (
    <div
      className="flex items-stretch h-9 border-b border-border/60 bg-muted/30 overflow-x-auto no-scrollbar"
      role="tablist"
      aria-label="Open Mongo views"
    >
      <Tab
        href={`/mongo/${connectionId}/databases`}
        active={activeKey === "overview"}
        title="All databases"
        icon={<Home className="size-3 shrink-0" />}
        label="Overview"
        showClose={false}
      />
      {tabs.length > 0 && tabs.some((t) => t.kind !== "overview") ? (
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
              icon={iconFor(t)}
              label={tabLabel(t)}
              showClose
              onClose={() => closeTab(k)}
            />
          );
        })}
    </div>
  );
}

function iconFor(t: Tab): React.ReactNode {
  switch (t.kind) {
    case "database":
      return <Database className="size-3 shrink-0" />;
    case "collection":
      return <FileText className="size-3 shrink-0" />;
    case "current-op":
      return <Zap className="size-3 shrink-0" />;
    case "repl-status":
      return <Network className="size-3 shrink-0" />;
    case "server-status":
      return <Activity className="size-3 shrink-0" />;
    default:
      return <FileText className="size-3 shrink-0" />;
  }
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
        "group/mtab relative inline-flex items-stretch h-9 max-w-[260px] min-w-0 transition-colors",
        active
          ? "text-foreground bg-background"
          : "text-muted-foreground hover:text-foreground hover:bg-background/40",
      )}
      role="tab"
      aria-selected={active}
      onMouseDown={(e) => {
        // Middle-click should close, not open a new browser tab.
        if (e.button === 1 && onClose) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && onClose) {
          e.preventDefault();
          onClose();
        }
      }}
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
            active ? "opacity-100" : "opacity-70 group-hover/mtab:opacity-100",
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
            "text-muted-foreground/0 group-hover/mtab:text-muted-foreground/70 focus-visible:text-foreground",
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
