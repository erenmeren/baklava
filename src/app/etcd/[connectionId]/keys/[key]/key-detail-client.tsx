"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { DetailBlock } from "@/components/data/detail-block";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowLeft, Loader2, RefreshCcw, Trash2 } from "lucide-react";

interface KeyDetail {
  key: string;
  value: string;
  createRevision: string;
  modRevision: string;
  version: string;
  lease: string;
}

interface Props {
  connectionId: string;
  keyName: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function KeyDetailClient({ connectionId, keyName }: Props) {
  const router = useRouter();
  const base = useMemo(
    () => `/api/etcd/${connectionId}/keys/${encodeURIComponent(keyName)}`,
    [connectionId, keyName]
  );

  const [detail, setDetail] = useState<KeyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(base, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Could not load key");
          if (showSpinner) setDetail(null);
          return;
        }
        setError(null);
        setDetail(data as KeyDetail);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [base]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Auto-refresh every 15s while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const deleteKey = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Key deleted");
        router.push(`/etcd/${connectionId}/keys`);
      } else {
        toast.error(data.error || "Could not delete");
      }
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const valueBytes = detail
    ? new TextEncoder().encode(detail.value).length
    : 0;

  return (
    <WorkspacePage
      title={
        <span
          className="font-mono text-base truncate inline-block max-w-[60ch] align-bottom"
          title={keyName}
        >
          {keyName}
        </span>
      }
      description={
        detail ? (
          <span className="flex items-center gap-2 flex-wrap mt-1">
            <Badge
              variant="secondary"
              className={cn(
                "text-[9px] font-mono uppercase tracking-wider border",
                "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30"
              )}
            >
              kv
            </Badge>
            <span className="text-[10px] font-mono text-muted-foreground">
              modRev {detail.modRevision}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              · {formatBytes(valueBytes)}
            </span>
          </span>
        ) : undefined
      }
      actions={
        <>
          <Link
            href={`/etcd/${connectionId}/keys`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load(true)}
            disabled={loading || busy}
          >
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy || !detail}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </>
      }
    >
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive mb-3">
          {error}
        </div>
      ) : null}

      {detail == null ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          <div className="min-w-0">
            <DetailBlock
              label="Value"
              content={detail.value}
              maxHeightClass="max-h-[60vh]"
            />
          </div>
          <aside className="space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Metadata
            </p>
            <div className="rounded-md border border-border/60 overflow-hidden">
              <table className="w-full text-xs font-mono">
                <tbody>
                  <MetaItem label="Key" value={detail.key} mono />
                  <MetaItem label="Create rev" value={detail.createRevision} />
                  <MetaItem label="Mod rev" value={detail.modRevision} />
                  <MetaItem label="Version" value={detail.version} />
                  <MetaItem
                    label="Lease"
                    value={detail.lease === "0" ? "—" : detail.lease}
                  />
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete key?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono break-all">{keyName}</span> from this
              etcd cluster. The operation cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteKey} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

function MetaItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <td className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground align-top w-24">
        {label}
      </td>
      <td
        className={cn(
          "px-3 py-1.5 align-top break-all",
          mono ? "font-mono text-[11px]" : "text-xs"
        )}
      >
        {value}
      </td>
    </tr>
  );
}
