"use client";

import { useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Download, Loader2, Upload } from "lucide-react";

type Mode = "postgres" | "kafka";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: Mode;
  /** Base download/restore URL, e.g. /api/postgres/<id>/databases/<db>/backup */
  endpoint: string;
  /** Human label for what's being backed up — db name or topic name. */
  subject: string;
}

export function BackupRestoreSheet({
  open,
  onOpenChange,
  mode,
  endpoint,
  subject,
}: Props) {
  // PG download options
  const [includeData, setIncludeData] = useState(true);
  // Kafka download options
  const [limit, setLimit] = useState("");
  // Kafka restore options
  const [targetTopic, setTargetTopic] = useState("");
  const [keepPartitions, setKeepPartitions] = useState(false);

  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadUrl = (() => {
    const params = new URLSearchParams();
    if (mode === "postgres" && !includeData) params.set("data", "0");
    if (mode === "kafka" && limit.trim()) params.set("limit", limit.trim());
    const qs = params.toString();
    return qs ? `${endpoint}?${qs}` : endpoint;
  })();

  const triggerDownload = () => {
    // A plain anchor click streams the file straight to disk — no buffering
    // in JS, so multi-GB dumps don't blow up the tab.
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Backup started", {
      description: "Your browser is downloading the file.",
    });
  };

  const onRestoreFile = async (file: File) => {
    setRestoring(true);
    try {
      const params = new URLSearchParams();
      if (mode === "kafka") {
        if (targetTopic.trim()) params.set("target", targetTopic.trim());
        params.set("partitions", keepPartitions ? "original" : "auto");
      }
      const url = params.toString()
        ? `${endpoint}?${params.toString()}`
        : endpoint;
      const body = await file.text();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type":
            mode === "postgres"
              ? "application/sql"
              : "application/x-ndjson",
        },
        body,
      });
      const data = await res.json();
      if (!res.ok || data.error || data.ok === false) {
        toast.error("Restore failed", {
          description: data.error || "See server logs",
        });
        return;
      }
      if (mode === "postgres") {
        toast.success("Restore complete", {
          description: `${data.statementsRun ?? 0} statements executed`,
        });
      } else {
        toast.success("Restore complete", {
          description: `${data.produced ?? 0} produced${data.skipped ? ` · ${data.skipped} skipped` : ""}`,
        });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error("Restore failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const accept = mode === "postgres" ? ".sql" : ".jsonl,.ndjson";
  const fileWord = mode === "postgres" ? ".sql dump" : ".jsonl backup";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col gap-0 p-0"
      >
        <SheetHeader className="p-5 pb-4 border-b border-border/60">
          <SheetTitle className="text-base">Backup &amp; restore</SheetTitle>
          <SheetDescription className="text-xs">
            <span className="font-mono">{subject}</span>
            {mode === "postgres"
              ? " · database"
              : " · topic"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
          {/* ── Download ────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider font-mono text-muted-foreground inline-flex items-center gap-1.5">
              <Download className="size-3" />
              Download backup
            </h3>

            {mode === "postgres" ? (
              <div className="flex items-center justify-between text-sm">
                <Label htmlFor="bk-data" className="cursor-pointer">
                  Include row data
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    Off = schema-only (DDL).
                  </span>
                </Label>
                <Switch
                  id="bk-data"
                  checked={includeData}
                  onCheckedChange={setIncludeData}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="bk-limit" className="text-xs">
                  Message limit (blank = all)
                </Label>
                <Input
                  id="bk-limit"
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="all messages"
                  className="h-8"
                />
              </div>
            )}

            <Button onClick={triggerDownload} className="w-full gap-1.5">
              <Download className="size-3.5" />
              Download {mode === "postgres" ? ".sql" : ".jsonl"}
            </Button>
          </section>

          <div className="h-px bg-border/60" />

          {/* ── Restore ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider font-mono text-muted-foreground inline-flex items-center gap-1.5">
              <Upload className="size-3" />
              Restore from {fileWord}
            </h3>

            {mode === "kafka" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="bk-target" className="text-xs">
                    Target topic (blank = same topic)
                  </Label>
                  <Input
                    id="bk-target"
                    value={targetTopic}
                    onChange={(e) => setTargetTopic(e.target.value)}
                    placeholder={subject}
                    className="h-8 font-mono"
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <Label htmlFor="bk-parts" className="cursor-pointer">
                    Keep original partitions
                    <span className="block text-[11px] text-muted-foreground font-normal">
                      Off = Kafka assigns by key hash.
                    </span>
                  </Label>
                  <Switch
                    id="bk-parts"
                    checked={keepPartitions}
                    onCheckedChange={setKeepPartitions}
                  />
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Executes the dump through one connection. The dump wraps
                itself in a transaction, so a failed restore rolls back.
              </p>
            )}

            <input
              ref={fileRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onRestoreFile(f);
              }}
            />
            <Button
              variant="outline"
              className={cn("w-full gap-1.5")}
              disabled={restoring}
              onClick={() => fileRef.current?.click()}
            >
              {restoring ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Choose {fileWord}…
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
