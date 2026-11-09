"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { K8S_RESOURCES, RESOURCE_GROUPS, type ResourceGroup } from "@/lib/kubernetes/commands";
import type { CrdLink } from "@/lib/kubernetes/crd";

const COLLAPSED_KEY = "baklava:k8s-sidebar-collapsed";
/** Groups folded until the viewer opens them — keeps the sidebar scannable. */
const DEFAULT_COLLAPSED: Partial<Record<ResourceGroup, boolean>> = {
  Access: true,
  "Custom resources": true,
};

interface NavItem {
  key: string;
  href: string;
  label: string;
  hotkey?: string;
  tag: string;
  title?: string;
}

interface Props {
  connectionId: string;
  context: string;
  serverVersion: string;
  nodes: number;
  namespaceCount: number;
}

export function K8sSidebar({
  connectionId,
  context,
  serverVersion,
  nodes,
  namespaceCount,
}: Props) {
  const pathname = usePathname();
  const base = `/kubernetes/${connectionId}`;
  const [collapsed, setCollapsed] = useState(DEFAULT_COLLAPSED);
  const [crds, setCrds] = useState<CrdLink[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved) setCollapsed(JSON.parse(saved));
    } catch {
      // Private window / blocked storage: keep the defaults.
    }
  }, []);

  // Installed CRDs for the "Custom resources" group. Best-effort: a kubeconfig
  // that can't list CRDs simply shows none.
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/kubernetes/${encodeURIComponent(connectionId)}/crds`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { crds?: CrdLink[] } | null) => setCrds(data?.crds ?? []))
      .catch(() => {});
    return () => ac.abort();
  }, [connectionId]);

  const toggle = (group: ResourceGroup) =>
    setCollapsed((c) => {
      const next = { ...c, [group]: !c[group] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Not persisted — still toggles for this page view.
      }
      return next;
    });

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const itemsFor = (group: ResourceGroup): NavItem[] => [
    ...K8S_RESOURCES.filter((r) => r.group === group).map((r) => ({
      key: r.path,
      href: `${base}/${r.path}`,
      label: r.label,
      hotkey: r.hotkey,
      tag: r.aliases[0] ?? r.path.slice(0, 3),
    })),
    ...(group === "Custom resources"
      ? crds.map((c) => ({
          key: `crd:${c.plural}.${c.group}`,
          href: `${base}/crd/${c.group}/${c.plural}`,
          label: c.kind,
          tag: "",
          title: `${c.plural}.${c.group}`,
        }))
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 font-mono text-[12px]">
      <div className="space-y-px">
        <Link href={base} className={cn("block rounded-sm px-2 py-1.5 transition-colors", pathname === base ? "bg-cyan-500/12 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>Overview</Link>
        <Link href={`${base}/topology`} className={cn("block rounded-sm px-2 py-1.5 transition-colors", isActive(`${base}/topology`) ? "bg-cyan-500/12 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>Topology</Link>
      </div>
      {RESOURCE_GROUPS.map((group) => {
        const items = itemsFor(group);
        // The group holding the current page never folds away.
        const open = !collapsed[group] || items.some((i) => isActive(i.href));
        return (
          <div key={group}>
            <button
              type="button"
              onClick={() => toggle(group)}
              aria-expanded={open}
              className="flex w-full items-center gap-1 px-1 pb-1.5 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80 hover:text-foreground"
            >
              <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
              <span className="flex-1 text-left">{group}</span>
            </button>
            {open && (
              <div className="space-y-px">
                {items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      title={item.title}
                      className={cn(
                        "group flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                        active
                          ? "bg-cyan-500/12 text-foreground"
                          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex w-4 justify-center text-[10px] tabular-nums",
                          active ? "text-cyan-500 dark:text-cyan-400" : "text-muted-foreground/60",
                        )}
                      >
                        {item.hotkey ?? ""}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      <span
                        className={cn(
                          "tabular-nums text-[9.5px] uppercase tracking-[0.22em] opacity-60",
                          active && "text-cyan-600 dark:text-cyan-400 opacity-100",
                        )}
                      >
                        {item.tag}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="mx-1 border-t border-border/60" />

      <div className="px-1 space-y-1.5 text-[10px] leading-relaxed">
        <div className="text-muted-foreground/80 uppercase tracking-[0.22em] text-[9px] pb-0.5">
          Cluster
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">ctx</span>
          <span className="text-foreground truncate ml-2 max-w-[140px]">
            {context}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">ver</span>
          <span className="text-foreground">{serverVersion}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">nodes</span>
          <span className="text-foreground tabular-nums">{nodes}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">ns</span>
          <span className="text-foreground tabular-nums">{namespaceCount}</span>
        </div>
      </div>

      <div className="mx-1 border-t border-border/60" />

      <div className="px-1 space-y-1 text-[10px] leading-relaxed text-muted-foreground">
        <div className="uppercase tracking-[0.22em] text-[9px] text-muted-foreground/80 pb-0.5">
          Quick keys
        </div>
        <KeyHint k=":" desc="command" />
        <KeyHint k="/" desc="filter" />
        <KeyHint k="?" desc="help" />
        <KeyHint k="j/k" desc="move" />
        <KeyHint k="↵" desc="describe" />
      </div>
    </div>
  );
}

function KeyHint({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="inline-flex min-w-[18px] justify-center rounded border border-border/60 bg-background/60 px-1 py-0 text-[9.5px] font-mono text-foreground/80">
        {k}
      </kbd>
      <span>{desc}</span>
    </div>
  );
}
