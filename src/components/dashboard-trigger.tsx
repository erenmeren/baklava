"use client";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

export function DashboardTrigger() {
  return (
    <Link
      href="/dashboard"
      title="Dashboard"
      aria-label="Open dashboard"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <LayoutDashboard className="size-4" />
    </Link>
  );
}
