"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  ArrowLeft,
  Clock,
  Infinity as InfIcon,
  Loader2,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

type RedisKeyType =
  | "string"
  | "list"
  | "hash"
  | "set"
  | "zset"
  | "stream"
  | "none";

interface ZsetEntry {
  member: string;
  score: number;
}

interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

type KeyValue =
  | string
  | string[]
  | Record<string, string>
  | ZsetEntry[]
  | StreamEntry[]
  | null;

interface KeyDetail {
  key: string;
  type: RedisKeyType;
  ttl: number;
  memoryBytes: number | null;
  value: KeyValue;
  truncated: boolean;
}

interface Props {
  connectionId: string;
  keyName: string;
}

const TYPE_TONE: Record<string, string> = {
  string: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  list: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  hash: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  set: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  zset: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  stream: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTtl(seconds: number): { label: string; tone: "none" | "soon" | "ok" } {
  if (seconds === -2) return { label: "expired", tone: "soon" };
  if (seconds === -1) return { label: "no expiry", tone: "none" };
  if (seconds < 60) return { label: `${seconds}s`, tone: "soon" };
  if (seconds < 3600) return { label: `${Math.floor(seconds / 60)}m`, tone: "ok" };
  if (seconds < 86400) return { label: `${Math.floor(seconds / 3600)}h`, tone: "ok" };
  return { label: `${Math.floor(seconds / 86400)}d`, tone: "ok" };
}

export function KeyDetailClient({ connectionId, keyName }: Props) {
  const router = useRouter();
  const base = useMemo(
    () =>
      `/api/redis/${connectionId}/keys/${encodeURIComponent(keyName)}`,
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
        router.push(`/redis/${connectionId}/keys`);
      } else {
        toast.error(data.error || "Could not delete");
      }
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const ttl = detail ? formatTtl(detail.ttl) : null;
  const typeClass = detail
    ? TYPE_TONE[detail.type] ??
      "bg-muted text-muted-foreground border-border/60"
    : "";

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
                typeClass
              )}
            >
              {detail.type}
            </Badge>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-mono",
                ttl?.tone === "soon"
                  ? "text-amber-700 dark:text-amber-300"
                  : ttl?.tone === "none"
                    ? "text-muted-foreground"
                    : "text-foreground/80"
              )}
            >
              {ttl?.tone === "none" ? (
                <InfIcon className="size-3" />
              ) : (
                <Clock className="size-3" />
              )}
              {ttl?.label}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              · {formatBytes(detail.memoryBytes)}
            </span>
          </span>
        ) : undefined
      }
      actions={
        <>
          <Link
            href={`/redis/${connectionId}/keys`}
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
        <div className="space-y-4">
          <KeyBody detail={detail} />
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete key?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono break-all">{keyName}</span> from this
              Redis database. The operation cannot be undone.
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

// ──────────────────────────────────────────────────────────────────────────────
// Type-specific value renderers
// ──────────────────────────────────────────────────────────────────────────────

function KeyBody({ detail }: { detail: KeyDetail }) {
  switch (detail.type) {
    case "string":
      return (
        <DetailBlock
          label="Value"
          content={typeof detail.value === "string" ? detail.value : ""}
          maxHeightClass="max-h-[60vh]"
        />
      );
    case "list":
      return <ListView items={detail.value as string[]} truncated={detail.truncated} />;
    case "hash":
      return <HashView entries={detail.value as Record<string, string>} />;
    case "set":
      return <SetView members={detail.value as string[]} truncated={detail.truncated} />;
    case "zset":
      return <ZsetView entries={detail.value as ZsetEntry[]} truncated={detail.truncated} />;
    case "stream":
      return (
        <StreamView entries={detail.value as StreamEntry[]} truncated={detail.truncated} />
      );
    default:
      return (
        <p className="text-sm text-muted-foreground">
          No renderer for type{" "}
          <span className="font-mono">{detail.type}</span>.
        </p>
      );
  }
}

function TruncatedNotice({
  count,
  cap,
  noun,
}: {
  count: number;
  cap: number;
  noun: string;
}) {
  return (
    <p className="text-[11px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300">
      Showing first {Math.min(count, cap)} {noun}
    </p>
  );
}

function ListView({ items, truncated }: { items: string[]; truncated: boolean }) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/50">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-3 py-2 text-left w-16">#</th>
              <th className="px-3 py-2 text-left">Value</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v, i) => (
              <tr key={i} className="border-t border-border/30">
                <td className="px-3 py-1.5 text-muted-foreground tabular-nums align-top">
                  {i}
                </td>
                <td className="px-3 py-1.5 whitespace-pre-wrap break-words align-top">
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? <TruncatedNotice count={items.length} cap={500} noun="entries" /> : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty list.</p>
      ) : null}
    </div>
  );
}

function HashView({ entries }: { entries: Record<string, string> }) {
  const [filter, setFilter] = useState("");
  const rows = Object.entries(entries);
  const filtered = filter
    ? rows.filter(([k]) => k.toLowerCase().includes(filter.toLowerCase()))
    : rows;
  return (
    <div className="space-y-2">
      <div className="relative max-w-sm">
        <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter fields…"
          className="h-8 pl-8 text-xs font-mono"
          spellCheck={false}
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty hash.</p>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/50">
              <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-3 py-2 text-left w-1/3">Field</th>
                <th className="px-3 py-2 text-left">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(([k, v]) => (
                <tr key={k} className="border-t border-border/30">
                  <td className="px-3 py-1.5 text-muted-foreground align-top break-all">
                    {k}
                  </td>
                  <td className="px-3 py-1.5 whitespace-pre-wrap break-words align-top">
                    {v}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-center text-muted-foreground">
                    No fields match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SetView({
  members,
  truncated,
}: {
  members: string[];
  truncated: boolean;
}) {
  return (
    <div className="space-y-2">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty set.</p>
      ) : (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 max-h-[60vh] overflow-auto">
          <div className="flex flex-wrap gap-1.5">
            {members.map((m, i) => (
              <span
                key={`${m}-${i}`}
                className="font-mono text-[11px] rounded-full border border-border/60 bg-background px-2 py-0.5 break-all"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
      {truncated ? <TruncatedNotice count={members.length} cap={500} noun="members" /> : null}
    </div>
  );
}

function ZsetView({
  entries,
  truncated,
}: {
  entries: ZsetEntry[];
  truncated: boolean;
}) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/50">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-3 py-2 text-left w-24">Score</th>
              <th className="px-3 py-2 text-left">Member</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => (
              <tr key={`${e.member}-${i}`} className="border-t border-border/30">
                <td className="px-3 py-1.5 tabular-nums text-muted-foreground align-top">
                  {e.score}
                </td>
                <td className="px-3 py-1.5 whitespace-pre-wrap break-words align-top">
                  {e.member}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? <TruncatedNotice count={entries.length} cap={500} noun="entries" /> : null}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty sorted set.</p>
      ) : null}
    </div>
  );
}

function StreamView({
  entries,
  truncated,
}: {
  entries: StreamEntry[];
  truncated: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/50">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-3 py-2 text-left w-44">ID</th>
              <th className="px-3 py-2 text-left">Fields</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-border/30">
                <td className="px-3 py-1.5 text-muted-foreground align-top whitespace-nowrap">
                  {e.id}
                </td>
                <td className="px-3 py-1.5 whitespace-pre-wrap break-words align-top">
                  {JSON.stringify(e.fields, null, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? <TruncatedNotice count={entries.length} cap={100} noun="entries" /> : null}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Empty stream.</p>
      ) : null}
    </div>
  );
}
