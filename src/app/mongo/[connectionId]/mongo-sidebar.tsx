"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Database, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

interface DbEntry {
  name: string;
  sizeOnDisk: number;
}

interface Props {
  connectionId: string;
  databases: DbEntry[];
  version: string;
  topology: string;
}

function formatSize(b: number): string {
  if (!b) return "—";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

export function MongoSidebar({
  connectionId,
  databases,
  version,
  topology,
}: Props) {
  const pathname = usePathname();
  const base = `/mongo/${connectionId}`;
  const sortedDbs = useMemo(
    () => [...databases].sort((a, b) => a.name.localeCompare(b.name)),
    [databases],
  );

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      <div>
        <div className="px-1 pb-1.5 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
          Workspace
        </div>
        <div className="space-y-px">
          <SidebarLink
            href={`${base}/databases`}
            active={pathname === `${base}/databases`}
            icon={<Database className="size-3.5" />}
          >
            Databases
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
              {databases.length}
            </span>
          </SidebarLink>
          <SidebarLink
            href={`${base}/server-status`}
            active={pathname === `${base}/server-status`}
            icon={<Activity className="size-3.5" />}
          >
            Server status
          </SidebarLink>
        </div>
      </div>

      {sortedDbs.length > 0 ? (
        <>
          <div className="mx-1 border-t border-border/60" />
          <div>
            <div className="px-1 pb-1.5 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
              Databases
            </div>
            <div className="space-y-px font-mono">
              {sortedDbs.map((d) => {
                const href = `${base}/databases/${encodeURIComponent(d.name)}`;
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={d.name}
                    href={href}
                    className={cn(
                      "group flex items-center gap-1.5 rounded-sm px-2 py-1 transition-colors text-[11.5px]",
                      active
                        ? "bg-emerald-500/12 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-transform",
                        active && "rotate-90 text-emerald-500 dark:text-emerald-400",
                      )}
                    />
                    <span className="truncate flex-1">{d.name}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground/70">
                      {formatSize(d.sizeOnDisk)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="mx-1 border-t border-border/60" />

      <div className="px-1 space-y-1.5 text-[10px] leading-relaxed">
        <div className="text-muted-foreground/80 uppercase tracking-[0.22em] text-[9px] pb-0.5">
          Server
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">version</span>
          <span className="text-foreground tabular-nums">{version}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">topology</span>
          <span className="text-foreground truncate ml-2">{topology}</span>
        </div>
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
        active
          ? "bg-emerald-500/12 text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex w-4 justify-center",
          active ? "text-emerald-500 dark:text-emerald-400" : "text-muted-foreground/60",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate flex items-center">{children}</span>
    </Link>
  );
}
