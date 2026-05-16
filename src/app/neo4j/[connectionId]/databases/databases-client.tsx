"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { RefreshCcw, Search } from "lucide-react";

interface DatabaseSummary {
  name: string;
  address?: string;
  role?: string;
  requestedStatus?: string;
  currentStatus?: string;
  default: boolean;
  home: boolean;
}

interface Props {
  connectionId: string;
}

export function DatabasesClient({ connectionId }: Props) {
  const [databases, setDatabases] = useState<DatabaseSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/neo4j/${connectionId}/databases`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setDatabases(data.databases as DatabaseSummary[]);
      else {
        setError(data.error || "Could not load databases");
        toast.error("Could not load", { description: data.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (databases == null) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return databases;
    return databases.filter((d) => d.name.toLowerCase().includes(q));
  }, [databases, filter]);

  return (
    <WorkspacePage
      title="Databases"
      description={
        databases ? `${databases.length} total` : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name"
            className="pl-7 h-8"
          />
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {databases === null ? (
          <Skeleton className="h-64" />
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
            {filter ? "No databases match that filter." : "No databases."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((db) => (
                  <TableRow key={db.name}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/neo4j/${connectionId}/databases/${encodeURIComponent(db.name)}`}
                        className="hover:underline text-foreground/90 hover:text-foreground"
                      >
                        {db.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={db.currentStatus} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono uppercase">
                      {db.role ?? "—"}
                    </TableCell>
                    <TableCell className="space-x-1">
                      {db.default ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30"
                        >
                          default
                        </Badge>
                      ) : null}
                      {db.home ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-mono uppercase tracking-wider"
                        >
                          home
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {db.address ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function StatusPill({ status }: { status?: string }) {
  const label = (status ?? "unknown").toLowerCase();
  const tone = (() => {
    switch (label) {
      case "online":
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
      case "starting":
      case "stopping":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40";
      case "offline":
      case "stopped":
        return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40";
      default:
        return "bg-muted/50 text-muted-foreground border-border/60";
    }
  })();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border",
        tone
      )}
    >
      {label}
    </span>
  );
}
