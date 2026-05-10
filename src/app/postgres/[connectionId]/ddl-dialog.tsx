"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  fetchUrl: string | null;
  /** which key in the JSON response holds the SQL string */
  payloadKey: "ddl" | "definition";
  /** prefix prepended to definition, e.g. `CREATE OR REPLACE VIEW … AS\n` */
  prefix?: string;
}

export function DDLDialog({
  open,
  onOpenChange,
  title,
  description,
  fetchUrl,
  payloadKey,
  prefix,
}: Props) {
  const [sql, setSql] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !fetchUrl) return;
    setSql(null);
    setLoading(true);
    fetch(fetchUrl, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load DDL");
        const raw = data[payloadKey] as string | undefined;
        setSql((prefix ?? "") + (raw ?? ""));
      })
      .catch((err) => {
        toast.error("Could not load DDL", {
          description: err instanceof Error ? err.message : String(err),
        });
        setSql(null);
      })
      .finally(() => setLoading(false));
  }, [open, fetchUrl, payloadKey, prefix]);

  const copy = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="font-mono">{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="rounded-md border border-border/60 bg-muted/30 max-h-[60vh] overflow-auto">
          {loading || sql === null ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : (
            <pre className="p-4 text-[12px] font-mono leading-[1.55] whitespace-pre overflow-x-auto">
              {sql}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!sql}
            onClick={copy}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
