"use client";
import Link from "next/link";
import { Gauge } from "lucide-react";

export function LoadTestTrigger() {
  return (
    <Link
      href="/loadtest"
      title="Load Testing"
      aria-label="Open load testing"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <Gauge className="size-4" />
    </Link>
  );
}
