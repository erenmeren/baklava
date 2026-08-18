"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  context: string;
  serverVersion: string;
  nodes: number;
  namespaceCount: number;
}

interface NavItem {
  href: string;
  short: string; // colon-command key (k9s style)
  key: string; // sidebar hotkey hint character
  label: string;
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

  const items: NavItem[] = [
    { href: `${base}/pods`,        short: "po",  key: "1", label: "Pods" },
    { href: `${base}/deployments`, short: "dep", key: "2", label: "Deployments" },
    { href: `${base}/services`,    short: "svc", key: "3", label: "Services" },
    { href: `${base}/configmaps`,  short: "cm",  key: "4", label: "ConfigMaps" },
    { href: `${base}/secrets`,     short: "sec", key: "5", label: "Secrets" },
    { href: `${base}/namespaces`,  short: "ns",  key: "6", label: "Namespaces" },
    { href: `${base}/nodes`,       short: "no",  key: "7", label: "Nodes" },
    { href: `${base}/events`,      short: "ev",  key: "8", label: "Events" },
  ];

  return (
    <div className="flex flex-col gap-3 font-mono text-[12px]">
      <div>
        <div className="px-1 pb-1.5 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
          Resources
        </div>
        <div className="space-y-px">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
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
                    active
                      ? "text-cyan-500 dark:text-cyan-400"
                      : "text-muted-foreground/60",
                  )}
                >
                  {item.key}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                <span
                  className={cn(
                    "tabular-nums text-[9.5px] uppercase tracking-[0.22em] opacity-60",
                    active && "text-cyan-600 dark:text-cyan-400 opacity-100",
                  )}
                >
                  {item.short}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

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
