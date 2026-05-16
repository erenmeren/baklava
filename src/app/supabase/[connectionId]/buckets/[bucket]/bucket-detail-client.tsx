"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RelativeTime } from "@/components/workspace/relative-time";
import { formatBytes } from "@/components/workspace/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronRight,
  File as FileIcon,
  Folder,
  RefreshCcw,
} from "lucide-react";

interface BucketEntry {
  name: string;
  isFolder: boolean;
  size: number | null;
  mimeType: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

interface Props {
  connectionId: string;
  bucketName: string;
}

export function BucketDetailClient({ connectionId, bucketName }: Props) {
  const [entries, setEntries] = useState<BucketEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  // path segments — empty array means root.
  const [path, setPath] = useState<string[]>([]);

  const prefix = path.join("/");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (prefix) params.set("prefix", prefix);
      const res = await fetch(
        `/api/supabase/${connectionId}/buckets/${encodeURIComponent(bucketName)}/files?${params.toString()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setEntries(data.entries as BucketEntry[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, bucketName, prefix]);

  useEffect(() => {
    load();
  }, [load]);

  const enter = (folder: string) => setPath((p) => [...p, folder]);
  const jumpTo = (index: number) =>
    setPath((p) => (index < 0 ? [] : p.slice(0, index + 1)));

  return (
    <WorkspacePage
      title={
        <span className="inline-flex items-center gap-2">
          <Link
            href={`/supabase/${connectionId}/buckets`}
            className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Buckets
          </Link>
          <span className="text-muted-foreground/60">/</span>
          <span className="font-mono">{bucketName}</span>
        </span>
      }
      description={
        entries
          ? `${entries.length} item${entries.length === 1 ? "" : "s"} in /${prefix}`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <Breadcrumbs
          bucketName={bucketName}
          path={path}
          onJump={jumpTo}
        />

        {entries === null ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {path.length === 0 ? "Bucket is empty." : "Folder is empty."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left w-[100px]">Size</th>
                  <th className="px-3 py-2 text-left w-[180px]">Type</th>
                  <th className="px-3 py-2 text-left w-[110px]">Updated</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.name}
                    entry={entry}
                    onOpen={() => entry.isFolder && enter(entry.name)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function Breadcrumbs({
  bucketName,
  path,
  onJump,
}: {
  bucketName: string;
  path: string[];
  onJump: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs font-mono flex-wrap">
      <button
        type="button"
        onClick={() => onJump(-1)}
        className={cn(
          "px-1.5 py-0.5 rounded-md transition-colors",
          path.length === 0
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
        )}
      >
        {bucketName}
      </button>
      {path.map((seg, idx) => (
        <span key={`${seg}-${idx}`} className="inline-flex items-center gap-1">
          <ChevronRight className="size-3 text-muted-foreground/60" />
          <button
            type="button"
            onClick={() => onJump(idx)}
            className={cn(
              "px-1.5 py-0.5 rounded-md transition-colors",
              idx === path.length - 1
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            {seg}
          </button>
        </span>
      ))}
    </div>
  );
}

function EntryRow({
  entry,
  onOpen,
}: {
  entry: BucketEntry;
  onOpen: () => void;
}) {
  if (entry.isFolder) {
    return (
      <tr
        className="border-t border-border/40 hover:bg-muted/30 cursor-pointer"
        onClick={onOpen}
      >
        <td className="px-3 py-2 align-middle">
          <span className="inline-flex items-center gap-2">
            <Folder className="size-3.5 text-emerald-500" />
            <span className="font-mono text-xs">{entry.name}/</span>
          </span>
        </td>
        <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
          —
        </td>
        <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
          folder
        </td>
        <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
          {entry.updatedAt ? <RelativeTime value={entry.updatedAt} /> : "—"}
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <span className="inline-flex items-center gap-2 min-w-0">
          <FileIcon className="size-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono text-xs truncate">{entry.name}</span>
        </span>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
        {entry.size != null ? formatBytes(entry.size) : "—"}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground truncate">
        {entry.mimeType ?? "—"}
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
        {entry.updatedAt ? <RelativeTime value={entry.updatedAt} /> : "—"}
      </td>
    </tr>
  );
}
