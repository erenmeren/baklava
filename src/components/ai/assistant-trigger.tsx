"use client";
import { Sparkles } from "lucide-react";
import { openAssistant } from "./assistant-events";

export function AssistantTrigger() {
  return (
    <button
      onClick={openAssistant}
      title="AI assistant"
      aria-label="Open AI assistant"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <Sparkles className="size-4" />
    </button>
  );
}
