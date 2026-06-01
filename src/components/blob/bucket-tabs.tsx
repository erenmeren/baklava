"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { TechId } from "@/lib/connections/types";
import { Boxes, Home, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab =
  | { kind: "overview" }
  | { kind: "bucket"; name: string };

interface Props {
  tech: TechId;
  connectionId: string;
}

function storageKey(tech: TechId, connectionId: string) {
  return `baklava:${tech}-tabs:${connectionId}`;
}

function loadTabs(tech: TechId, connectionId: string): Tab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tech, connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Tab[]) : [];
  } catch {
    return [];
  }
}

function saveTabs(tech: TechId, connectionId: string, tabs: Tab[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tech, connectionId), JSON.stringify(tabs));
  } catch {
    // ignore
  }
}

function tabKey(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "overview";
    case "bucket":
      return `b:${t.name}`;
  }
}

function tabHref(tech: TechId, connectionId: string, t: Tab): string {
  switch (t.kind) {
    case "overview":
      return `/${tech}/${connectionId}`;
    case "bucket":
      return `/${tech}/${connectionId}/buckets/${encodeURIComponent(t.name)}`;
  }
}

function tabLabel(t: Tab): string {
  switch (t.kind) {
    case "overview":
      return "Overview";
    case "bucket":
      return t.name;
  }
}

function tabFromPath(tech: TechId, pathname: string, connectionId: string): Tab | null {
  const prefix = `/${tech}/${connectionId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest === "/") {
    return { kind: "overview" };
  }
  // /buckets/[bucket]
  const bucketMatch = rest.match(/^\/buckets\/([^/]+)/);
  if (bucketMatch) {
    return { kind: "bucket", name: decodeURIComponent(bucketMatch[1]) };
  }
  return null;
}

export function BucketTabs({ tech, connectionId }: Props) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTabs(loadTabs(tech, connectionId));
    setHydrated(true);
  }, [tech, connectionId]);

  useEffect(() => {
    if (hydrated) saveTabs(tech, connectionId, tabs);
  }, [tabs, hydrated, tech, connectionId]);

  const activeTab = useMemo(
    () => tabFromPath(tech, pathname, connectionId),
    [tech, pathname, connectionId],
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
        router.push(
          fallback ? tabHref(tech, connectionId, fallback) : `/${tech}/${connectionId}`,
        );
      }
    },
    [tabs, activeKey, router, tech, connectionId],
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
      aria-label="Open bucket views"
    >
      <Tab
        href={`/${tech}/${connectionId}`}
        active={activeKey === "overview"}
        title="Overview"
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
              href={tabHref(tech, connectionId, t)}
              active={active}
              title={tabLabel(t)}
              icon={<Boxes className="size-3 shrink-0" />}
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
        "group/blobtab relative inline-flex items-stretch h-9 max-w-[260px] min-w-0 transition-colors",
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
            active ? "opacity-100" : "opacity-70 group-hover/r2tab:opacity-100",
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
            "text-muted-foreground/0 group-hover/r2tab:text-muted-foreground/70 focus-visible:text-foreground",
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
