"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  downloadText,
  rowsToCSV,
  rowsToJSON,
  rowsToTSV,
} from "@/lib/sql/result-export";

// Compact Copy / CSV / JSON toolbar shown above a result grid in both SQL
// editors. Copy writes TSV (spreadsheet-friendly); the downloads are CSV/JSON.
export function ResultActions({
  fields,
  rows,
  rowCount,
  filenameBase,
  className,
}: {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  filenameBase: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (fields.length === 0) return null;

  const safe = filenameBase.replace(/[^A-Za-z0-9._-]/g, "_") || "result";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rowsToTSV(fields, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const btn =
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors";

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <span className="mr-1 text-[10px] font-mono tabular-nums text-muted-foreground/70">
        {rowCount.toLocaleString()} row{rowCount === 1 ? "" : "s"}
      </span>
      <button type="button" onClick={copy} className={btn} title="Copy as TSV">
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "copied" : "copy"}
      </button>
      <button
        type="button"
        onClick={() =>
          downloadText(`${safe}.csv`, rowsToCSV(fields, rows), "text/csv;charset=utf-8")
        }
        className={btn}
        title="Download as CSV"
      >
        <Download className="size-3" />
        csv
      </button>
      <button
        type="button"
        onClick={() =>
          downloadText(
            `${safe}.json`,
            rowsToJSON(fields, rows),
            "application/json",
          )
        }
        className={btn}
        title="Download as JSON"
      >
        json
      </button>
    </div>
  );
}
