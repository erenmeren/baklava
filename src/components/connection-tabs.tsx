"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, X, ArrowUpRight } from "lucide-react";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";
import { TECH_CATALOG, techIconUrl } from "@/lib/tech-catalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const FIRST_PAGE: Record<TechId, string> = {
  docker: "containers",
  postgres: "",
  kafka: "",
  redis: "keys",
  mysql: "databases",
  sqlserver: "databases",
  mongo: "databases",
  rabbit: "queues",
  elastic: "indices",
  clickhouse: "tables",
  nats: "streams",
  sqlite: "tables",
  etcd: "keys",
  kubernetes: "pods",
};

const STORAGE_KEY = "baklava:open-tabs";

function workspaceHref(tech: TechId, id: string) {
  const seg = FIRST_PAGE[tech];
  return seg ? `/${tech}/${id}/${seg}` : `/${tech}/${id}`;
}

interface ConnectionsResponse {
  connections: ConnectionRecord[];
}

function loadOpenTabs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveOpenTabs(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode errors
  }
}

function activeIdFromPath(pathname: string): string | null {
  // /docker/<id>/...   /postgres/<id>/...   /kafka/<id>/...
  const m = pathname.match(/^\/(?:docker|postgres|kafka)\/([^/]+)/);
  return m ? m[1] : null;
}

export function ConnectionTabs() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [conns, setConns] = useState<ConnectionRecord[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Hydrate from localStorage once on the client.
  useEffect(() => {
    setOpenIds(loadOpenTabs());
    setHydrated(true);
  }, []);

  // Persist on change.
  useEffect(() => {
    if (hydrated) saveOpenTabs(openIds);
  }, [openIds, hydrated]);

  // Poll saved connections.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/connections", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ConnectionsResponse;
        if (!cancelled) {
          setConns(data.connections);
          setFetched(true);
        }
      } catch {
        // best-effort
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const connectionsById = useMemo(() => {
    const map = new Map<string, ConnectionRecord>();
    for (const c of conns) map.set(c.id, c);
    return map;
  }, [conns]);

  // Auto-open the active connection's tab if not already in the strip.
  useEffect(() => {
    const active = activeIdFromPath(pathname);
    if (!active) return;
    if (!hydrated) return;
    if (!connectionsById.has(active)) return; // wait for server data
    setOpenIds((prev) => (prev.includes(active) ? prev : [...prev, active]));
  }, [pathname, hydrated, connectionsById]);

  // Drop stale tab ids whose connection no longer exists (after first server load).
  useEffect(() => {
    if (!hydrated) return;
    if (!fetched) return;
    setOpenIds((prev) => prev.filter((id) => connectionsById.has(id)));
  }, [conns, connectionsById, hydrated, fetched]);

  const openTabs = useMemo(
    () =>
      openIds
        .map((id) => connectionsById.get(id))
        .filter((c): c is ConnectionRecord => Boolean(c)),
    [openIds, connectionsById],
  );

  const closableConnections = useMemo(
    () => conns.filter((c) => !openIds.includes(c.id)),
    [conns, openIds],
  );

  const closeTab = useCallback(
    (id: string) => {
      const idx = openIds.indexOf(id);
      const nextIds = openIds.filter((x) => x !== id);
      setOpenIds(nextIds);

      const wasActive = activeIdFromPath(pathname) === id;
      if (wasActive) {
        const fallback =
          nextIds[idx - 1] ??
          nextIds[idx] ??
          nextIds[nextIds.length - 1] ??
          null;
        if (fallback) {
          const c = connectionsById.get(fallback);
          if (c) {
            router.push(workspaceHref(c.tech, c.id));
            return;
          }
        }
        router.push("/");
      }
    },
    [openIds, pathname, connectionsById, router],
  );

  const openInTab = useCallback(
    (c: ConnectionRecord) => {
      setOpenIds((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
      setPickerOpen(false);
      router.push(workspaceHref(c.tech, c.id));
    },
    [router],
  );

  return (
    <nav
      aria-label="Open connections"
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar"
    >
      {openTabs.map((c) => {
        const tech = TECH_CATALOG.find((t) => t.id === c.tech);
        if (!tech) return null;
        const active = pathname.startsWith(`/${c.tech}/${c.id}`);
        return (
          <Tab
            key={c.id}
            href={workspaceHref(c.tech, c.id)}
            active={active}
            title={`${c.name} — ${tech.name}`}
            icon={
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={techIconUrl(tech)}
                alt=""
                width={14}
                height={14}
                draggable={false}
                aria-hidden
                className="size-3.5 select-none dark:brightness-0 dark:invert"
              />
            }
            label={c.name}
            statusDot={c.status}
            onClose={() => closeTab(c.id)}
          />
        );
      })}

      <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
        <DropdownMenuTrigger
          aria-label="Open connection in a new tab"
          className={cn(
            "group relative inline-flex items-center justify-center h-12 px-2.5 ml-0.5 outline-none",
            "text-muted-foreground/70 hover:text-foreground transition-colors",
            "data-[popup-open]:text-foreground",
          )}
          title="Open connection"
        >
          <span className="size-5 rounded grid place-items-center border border-dashed border-border group-hover:border-brand/60 group-hover:text-brand group-data-[popup-open]:border-brand/70 group-data-[popup-open]:text-brand transition-colors">
            <Plus className="size-3" strokeWidth={2.4} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="min-w-[280px] p-1.5"
        >
          <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Open as new tab
          </div>
          {closableConnections.length === 0 ? (
            <div className="px-2 py-3 text-[12.5px] text-muted-foreground">
              {conns.length === 0
                ? "No saved connections yet."
                : "All connections are already open."}
            </div>
          ) : (
            <ul className="flex flex-col gap-px">
              {closableConnections.map((c) => {
                const tech = TECH_CATALOG.find((t) => t.id === c.tech);
                if (!tech) return null;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openInTab(c)}
                      className="group w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent/60 focus-visible:bg-accent/60 outline-none transition-colors"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={techIconUrl(tech)}
                        alt=""
                        width={18}
                        height={18}
                        draggable={false}
                        aria-hidden
                        className="size-[18px] shrink-0 select-none dark:brightness-0 dark:invert"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium leading-tight truncate">
                          {c.name}
                        </div>
                        <div className="text-[10.5px] font-mono text-muted-foreground/80 leading-tight mt-0.5 truncate">
                          {tech.name.toLowerCase()}
                          {c.status === "error" ? " · error" : ""}
                          {c.status === "untested" ? " · untested" : ""}
                        </div>
                      </div>
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full shrink-0",
                          c.status === "ok"
                            ? "bg-brand"
                            : c.status === "error"
                              ? "bg-destructive"
                              : "bg-muted-foreground/40",
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="my-1 h-px bg-border/60" />
          <Link
            href="/"
            onClick={() => setPickerOpen(false)}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="size-3.5" />
              New connection
            </span>
            <ArrowUpRight className="size-3.5 opacity-60" />
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

interface TabProps {
  href: string;
  active: boolean;
  title: string;
  label: string;
  icon: React.ReactNode;
  statusDot?: "ok" | "error" | "untested";
  onClose?: () => void;
}

function Tab({
  href,
  active,
  title,
  label,
  icon,
  statusDot,
  onClose,
}: TabProps) {
  return (
    <div
      className={cn(
        "group relative inline-flex items-stretch h-12 max-w-[240px] min-w-0",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
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
      <Link
        href={href}
        title={title}
        aria-current={active ? "page" : undefined}
        className={cn(
          "inline-flex items-center gap-2 pl-3 min-w-0",
          onClose ? "pr-1" : "pr-3",
          "text-[12.5px] tracking-tight whitespace-nowrap transition-colors",
        )}
      >
        <span
          className={cn(
            "shrink-0 grid place-items-center transition-opacity",
            active ? "opacity-100" : "opacity-70 group-hover:opacity-100",
          )}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {statusDot ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full shrink-0",
              statusDot === "ok"
                ? "bg-brand"
                : statusDot === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground/40",
            )}
          />
        ) : null}
      </Link>
      {onClose ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${label} tab`}
          title="Close tab"
          className={cn(
            "self-center mx-1 size-4 grid place-items-center rounded outline-none shrink-0",
            "text-muted-foreground/0 group-hover:text-muted-foreground/80 focus-visible:text-foreground",
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
