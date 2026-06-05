"use client";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export function AssistantTrigger() {
  return (
    <Link
      href="/assistant"
      title="AI assistant"
      aria-label="Open AI assistant"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <Sparkles className="size-4" />
    </Link>
  );
}
