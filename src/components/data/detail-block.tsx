"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DetailBlockProps {
  label: string;
  content: string | null;
  /** Override the default `max-h-[40vh]` cap on the <pre> body. */
  maxHeightClass?: string;
}

/**
 * Renders a labeled value block with JSON auto-detect + pretty-print and a
 * copy-to-clipboard button. Lifted out of kafka topic detail so redis +
 * etcd key detail can share it.
 */
export function DetailBlock({
  label,
  content,
  maxHeightClass = "max-h-[40vh]",
}: DetailBlockProps) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => prettyPrintJson(content), [content]);
  const isJson = pretty !== content && content != null;

  const onCopy = async () => {
    if (content == null) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {label}
          {isJson ? (
            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 normal-case tracking-normal">
              json
            </span>
          ) : null}
        </p>
        {content != null ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={onCopy}
            className="h-6 px-2"
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "copied" : "copy"}
          </Button>
        ) : null}
      </div>
      {content == null ? (
        <p className="text-xs text-muted-foreground">null</p>
      ) : (
        <pre
          className={cn(
            "rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words overflow-auto",
            maxHeightClass
          )}
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}

export function prettyPrintJson(s: string | null): string {
  if (s == null) return "";
  const trimmed = s.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // fall through
    }
  }
  return s;
}
