"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { K8S_RESOURCES, RESOURCE_GROUPS } from "@/lib/kubernetes/commands";

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

  return (
    <div className="flex flex-col gap-3 font-mono text-[12px]">
      {RESOURCE_GROUPS.map((group) => (
        <div key={group}>
          <div className="px-1 pb-1.5 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
            {group}
          </div>
          <div className="space-y-px">
            {K8S_RESOURCES.filter((r) => r.group === group).map((item) => {
              const href = `${base}/${item.path}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={item.path}
                  href={href}
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
                    {item.aliases[0] ?? item.path.slice(0, 3)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

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
