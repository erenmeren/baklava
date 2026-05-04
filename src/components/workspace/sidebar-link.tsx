"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SidebarLinkProps {
  href: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  exact?: boolean;
  rightSlot?: React.ReactNode;
}

export function SidebarLink({
  href,
  icon,
  children,
  exact,
  rightSlot,
}: SidebarLinkProps) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-foreground/10 text-foreground font-medium"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="truncate flex-1">{children}</span>
      {rightSlot}
    </Link>
  );
}

export function SidebarSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      {title ? (
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      ) : null}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
