"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Module {
  name: string;
  version: string;
}

interface Props {
  connectionId: string;
  mode: "single" | "cluster";
  databases: number;
  modules: Module[];
  isCluster: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export function RedisSidebar({
  connectionId,
  mode,
  databases,
  modules,
  isCluster,
}: Props) {
  const pathname = usePathname();
  const base = `/redis/${connectionId}`;

  const items: NavItem[] = [
    { href: `${base}/keys`, label: "Keys", icon: "K" },
    { href: `${base}/cli`, label: "CLI", icon: ">" },
    { href: `${base}/pubsub`, label: "Pub/Sub", icon: "P" },
    { href: `${base}/streams`, label: "Streams", icon: "X" },
    { href: `${base}/monitor`, label: "Monitor", icon: "M" },
    { href: `${base}/info`, label: "Info & Clients", icon: "i" },
    { href: `${base}/acl`, label: "ACL", icon: "A" },
  ];
  if (isCluster) {
    items.push({ href: `${base}/cluster`, label: "Cluster", icon: "C" });
  }

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      <div>
        <div className="px-1 pb-1.5 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
          Workspace
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
                    ? "bg-rose-500/12 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "inline-flex w-4 justify-center font-mono text-[10px]",
                    active
                      ? "text-rose-500 dark:text-rose-400"
                      : "text-muted-foreground/60",
                  )}
                >
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mx-1 border-t border-border/60" />

      <div className="px-1 space-y-1.5 text-[10px] leading-relaxed">
        <div className="text-muted-foreground/80 uppercase tracking-[0.22em] text-[9px] pb-0.5">
          Server
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">mode</span>
          <span className="text-foreground">{mode}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">dbs</span>
          <span className="text-foreground tabular-nums">{databases}</span>
        </div>
      </div>

      {modules.length > 0 ? (
        <>
          <div className="mx-1 border-t border-border/60" />
          <div className="px-1 space-y-1 text-[10px] leading-relaxed">
            <div className="text-muted-foreground/80 uppercase tracking-[0.22em] text-[9px] pb-0.5">
              Modules
            </div>
            {modules.map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between gap-2"
              >
                <span
                  className="text-foreground truncate font-mono"
                  title={m.name}
                >
                  {m.name}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  v{m.version}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
