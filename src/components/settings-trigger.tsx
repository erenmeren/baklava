"use client";
import Link from "next/link";
import { Settings2 } from "lucide-react";

export function SettingsTrigger() {
  return (
    <Link
      href="/settings"
      title="Settings"
      aria-label="Open settings"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <Settings2 className="size-4" />
    </Link>
  );
}
