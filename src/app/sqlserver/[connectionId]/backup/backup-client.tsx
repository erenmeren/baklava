"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface HistoryRow {
  type: string;
  startTime: string | null;
  finishTime: string | null;
  sizeBytes: number;
  device: string | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function BackupClient({
  connectionId,
  defaultDatabase,
}: {
  connectionId: string;
  defaultDatabase: string;
}) {
  const [database, setDatabase] = useState(defaultDatabase);
  const [databases, setDatabases] = useState<string[]>([defaultDatabase]);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void fetch(`/api/sqlserver/${connectionId}/databases`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        if (d.databases) setDatabases(d.databases.map((x: { name: string }) => x.name));
      })
      .catch(() => {});
  }, [connectionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setHistory(null);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/backup`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (res.ok) setHistory(d.history as HistoryRow[]);
      else toast.error("Could not load backup history", { description: d.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void load();
  }, [load]);

  const runBackup = async () => {
    if (!path.trim()) {
      toast.error("Enter a server-side backup path");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/backup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: path.trim() }),
        },
      );
      const d = await res.json();
      if (res.ok) {
        toast.success("Backup complete");
        await load();
      } else {
        toast.error("Backup failed", { description: d.error });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <WorkspacePage
      title="Backup"
      description="Native BACKUP DATABASE + history from msdb.dbo.backupset. The path is on the SQL Server host, not this machine."
      actions={
        <div className="flex items-center gap-2">
          <Select value={database} onValueChange={(v) => v && setDatabase(v)}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {databases.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RefreshButton onClick={load} loading={loading} />
        </div>
      }
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-3 max-w-2xl">
          <h2 className="text-sm font-medium inline-flex items-center gap-2">
            <DatabaseBackup className="size-4" />
            New full backup
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="bk-path" className="text-xs">
              Server-side path (on the SQL Server host)
            </Label>
            <div className="flex gap-2">
              <Input
                id="bk-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/var/opt/mssql/backups/mydb.bak"
                className="h-8 font-mono"
                spellCheck={false}
              />
              <Button onClick={runBackup} disabled={running} className="gap-1.5 shrink-0">
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <DatabaseBackup className="size-3.5" />
                )}
                Backup
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Runs <span className="font-mono">BACKUP DATABASE [{database}] TO DISK = … WITH COMPRESSION, CHECKSUM, INIT</span>.
              The SQL Server service account must be able to write there.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">
            Backup history
          </h2>
          {!history ? (
            <Skeleton className="h-40 w-full" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No backups recorded in msdb for this database.
            </p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Device</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{h.type}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {h.startTime ? new Date(h.startTime).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtBytes(h.sizeBytes)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground truncate max-w-[40ch]">
                        {h.device ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </WorkspacePage>
  );
}
