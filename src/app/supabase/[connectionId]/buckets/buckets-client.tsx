"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RelativeTime } from "@/components/workspace/relative-time";
import { formatBytes } from "@/components/workspace/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Globe2, Lock, RefreshCcw, Search } from "lucide-react";

interface SupabaseBucket {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  connectionId: string;
}

export function BucketsClient({ connectionId }: Props) {
  const [buckets, setBuckets] = useState<SupabaseBucket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/supabase/${connectionId}/buckets`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setBuckets(data.buckets as SupabaseBucket[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!buckets) return null;
    const q = search.trim().toLowerCase();
    if (!q) return buckets;
    return buckets.filter((b) => b.name.toLowerCase().includes(q));
  }, [buckets, search]);

  return (
    <WorkspacePage
      title="Buckets"
      description={
        buckets
          ? `${buckets.length} bucket${buckets.length === 1 ? "" : "s"} · ${buckets.filter((b) => b.public).length} public`
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search buckets…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {buckets === null ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {buckets.length === 0
              ? "No storage buckets in this project."
              : "No buckets match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left w-[90px]">Visibility</th>
                  <th className="px-3 py-2 text-left w-[100px]">Size limit</th>
                  <th className="px-3 py-2 text-left">MIME types</th>
                  <th className="px-3 py-2 text-left w-[110px]">Updated</th>
                </tr>
              </thead>
              <tbody>
                {(filtered ?? []).map((b) => (
                  <BucketRow
                    key={b.id}
                    bucket={b}
                    connectionId={connectionId}
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

function BucketRow({
  bucket,
  connectionId,
}: {
  bucket: SupabaseBucket;
  connectionId: string;
}) {
  const mimeSummary = bucket.allowedMimeTypes?.length
    ? bucket.allowedMimeTypes.length <= 2
      ? bucket.allowedMimeTypes.join(", ")
      : `${bucket.allowedMimeTypes.slice(0, 2).join(", ")} +${bucket.allowedMimeTypes.length - 2}`
    : "any";
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/supabase/${connectionId}/buckets/${encodeURIComponent(bucket.name)}`}
          className="font-mono text-xs hover:underline"
        >
          {bucket.name}
        </Link>
      </td>
      <td className="px-3 py-2 align-middle">
        {bucket.public ? (
          <Badge
            variant="secondary"
            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase tracking-wider"
          >
            <Globe2 className="size-2.5 mr-0.5" />
            public
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <Lock className="size-2.5" />
            private
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
        {bucket.fileSizeLimit ? formatBytes(bucket.fileSizeLimit) : "—"}
      </td>
      <td className="px-3 py-2 align-middle">
        <span className="font-mono text-xs text-muted-foreground truncate inline-block max-w-[40ch]">
          {mimeSummary}
        </span>
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
        <RelativeTime value={bucket.updatedAt} />
      </td>
    </tr>
  );
}
