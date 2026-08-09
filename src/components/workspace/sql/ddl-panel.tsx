"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * The shared DDL tab body for the postgres, mysql and sqlserver table
 * workspaces: a header strip naming the source of the DDL, a copy button,
 * and the `<pre>` block itself. Loading/error states stay with the caller —
 * this only renders once the DDL string is in hand.
 */
export function DdlPanel({ label, ddl }: { label: string; ddl: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 relative">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={async () => {
            if (!ddl) return;
            try {
              await navigator.clipboard.writeText(ddl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Could not copy");
            }
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="p-4 text-[12px] font-mono leading-[1.55] whitespace-pre overflow-x-auto max-h-[60vh] overflow-y-auto">
        {ddl}
      </pre>
    </div>
  );
}
