"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RelativeTime } from "@/components/workspace/relative-time";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Database,
  FolderArchive,
  Globe2,
  Lock,
  RefreshCcw,
  Users,
  Zap,
} from "lucide-react";

interface SupabaseBucket {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthUserSummary {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  providers: string[];
}

interface EdgeFunctionsResult {
  enabled: boolean;
  note?: string;
  functions: { name: string; status: string; version: number | null; createdAt: string | null }[];
}

interface Summary {
  url: string;
  projectRef: string | null;
  totalUsers: number | null;
  buckets: SupabaseBucket[];
  recentUsers: AuthUserSummary[];
  edgeFunctions: EdgeFunctionsResult;
  hasDatabaseUrl: boolean;
}

interface Props {
  connectionId: string;
}

const fmt = new Intl.NumberFormat("en-US");

export function OverviewClient({ connectionId }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/supabase/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setSummary(data as Summary);
      else {
        setError(data.error || "Could not load project overview");
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

  // 30s — Supabase APIs are rate-limited; don't hammer them.
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <WorkspacePage
      title="Project"
      description={
        summary
          ? `${summary.projectRef ?? "supabase"} · ${summary.buckets.length} bucket${summary.buckets.length === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
            auto · 30s
          </span>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </>
      }
    >
      {summary === null ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <ProjectStrip
            url={summary.url}
            projectRef={summary.projectRef}
          />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Users className="size-3.5" />}
              label="Auth users"
              value={summary.totalUsers ?? 0}
              sub={summary.totalUsers == null ? "count unavailable" : "total signups"}
              href={`/supabase/${connectionId}/auth-users`}
            />
            <StatTile
              icon={<FolderArchive className="size-3.5" />}
              label="Storage buckets"
              value={summary.buckets.length}
              sub={
                summary.buckets.length === 0
                  ? "none yet"
                  : `${summary.buckets.filter((b) => b.public).length} public`
              }
              href={`/supabase/${connectionId}/buckets`}
            />
            <EdgeStat
              edge={summary.edgeFunctions}
              connectionId={connectionId}
            />
            <DatabaseStat hasDatabaseUrl={summary.hasDatabaseUrl} />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <RecentUsersCard
              users={summary.recentUsers}
              connectionId={connectionId}
            />
            <BucketsCard
              buckets={summary.buckets}
              connectionId={connectionId}
            />
          </div>
        </div>
      )}
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function ProjectStrip({
  url,
  projectRef,
}: {
  url: string;
  projectRef: string | null;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-emerald-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Globe2 className="size-4 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Project URL
            </p>
            <p className="text-sm font-semibold truncate">
              <span className="font-mono">{url.replace(/^https?:\/\//, "")}</span>
              {projectRef ? (
                <span className="text-muted-foreground font-normal ml-2 font-mono text-xs">
                  ref {projectRef}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono border border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
          service_role
        </span>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  href,
  raw,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: React.ReactNode;
  href?: string;
  raw?: boolean;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] flex items-center gap-1.5">
          {icon}
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">
          {raw ? value : typeof value === "number" ? fmt.format(value) : value}
        </span>
      </div>
      {sub ? (
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </>
  );
  const base = cn(
    "rounded-lg border border-border/60 p-4 bg-card transition-colors",
    href && "cursor-pointer hover:border-foreground/30 hover:bg-muted/30"
  );
  return href ? (
    <Link href={href} className={base}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

function EdgeStat({
  edge,
  connectionId,
}: {
  edge: EdgeFunctionsResult;
  connectionId: string;
}) {
  return (
    <StatTile
      icon={<Zap className="size-3.5" />}
      label="Edge functions"
      value={edge.enabled ? edge.functions.length : "—"}
      raw={!edge.enabled}
      sub={edge.enabled ? "deployed" : "needs management API"}
      href={`/supabase/${connectionId}/functions`}
    />
  );
}

function DatabaseStat({ hasDatabaseUrl }: { hasDatabaseUrl: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 p-4 bg-card">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] flex items-center gap-1.5">
          <Database className="size-3.5" />
          Database
        </span>
        <Badge
          variant="secondary"
          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase tracking-wider"
        >
          postgres
        </Badge>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "text-base font-semibold tracking-tight",
            hasDatabaseUrl ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {hasDatabaseUrl ? "configured" : "not configured"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {hasDatabaseUrl
          ? "SQL passthrough planned"
          : "Add Database URL in the connection settings"}
      </p>
    </div>
  );
}

function RecentUsersCard({
  users,
  connectionId,
}: {
  users: AuthUserSummary[];
  connectionId: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users className="size-4 text-emerald-500" />
          Recent signups
        </h3>
        <Link
          href={`/supabase/${connectionId}/auth-users`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {users.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No users yet.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-mono text-xs truncate">
                  {u.email ?? u.phone ?? u.id}
                </span>
                {u.providers.length > 0 ? (
                  <span className="flex items-center gap-1">
                    {u.providers.slice(0, 3).map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="text-[9px] font-mono uppercase tracking-wider border-border/60"
                      >
                        {p}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                <RelativeTime value={u.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BucketsCard({
  buckets,
  connectionId,
}: {
  buckets: SupabaseBucket[];
  connectionId: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FolderArchive className="size-4 text-emerald-500" />
          Buckets
        </h3>
        <Link
          href={`/supabase/${connectionId}/buckets`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {buckets.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No storage buckets yet.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {buckets.slice(0, 6).map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex items-center gap-2">
                <Link
                  href={`/supabase/${connectionId}/buckets/${encodeURIComponent(b.name)}`}
                  className="font-mono text-xs truncate hover:underline"
                >
                  {b.name}
                </Link>
                {b.public ? (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase tracking-wider"
                  >
                    <Globe2 className="size-2.5 mr-0.5" />
                    public
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
                  >
                    <Lock className="size-2.5 mr-0.5" />
                    private
                  </Badge>
                )}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                <RelativeTime value={b.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
