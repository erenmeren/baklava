"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RelativeTime } from "@/components/workspace/relative-time";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Info, KeyRound, RefreshCcw, Zap } from "lucide-react";

interface EdgeFn {
  name: string;
  status: string;
  version: number | null;
  createdAt: string | null;
}

interface ApiResponse {
  enabled: boolean;
  note?: string;
  functions: EdgeFn[];
}

interface Props {
  connectionId: string;
}

export function FunctionsClient({ connectionId }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/supabase/${connectionId}/functions`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (res.ok) setData(body as ApiResponse);
      else toast.error("Could not load", { description: body.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspacePage
      title="Edge functions"
      description={
        data
          ? data.enabled
            ? `${data.functions.length} deployed`
            : "listing unavailable"
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {data === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data.enabled ? (
        <UnavailableCard note={data.note} />
      ) : data.functions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No edge functions deployed.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left w-[100px]">Status</th>
                <th className="px-3 py-2 text-left w-[80px]">Version</th>
                <th className="px-3 py-2 text-left w-[110px]">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.functions.map((fn) => (
                <FnRow key={fn.name} fn={fn} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspacePage>
  );
}

function FnRow({ fn }: { fn: EdgeFn }) {
  const isActive = fn.status?.toLowerCase() === "active";
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <span className="inline-flex items-center gap-2">
          <Zap className="size-3.5 text-emerald-500" />
          <span className="font-mono text-xs">{fn.name}</span>
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        {isActive ? (
          <Badge
            variant="secondary"
            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase tracking-wider"
          >
            active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
          >
            {fn.status || "inactive"}
          </Badge>
        )}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
        {fn.version ?? "—"}
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
        {fn.createdAt ? <RelativeTime value={fn.createdAt} /> : "—"}
      </td>
    </tr>
  );
}

function UnavailableCard({ note }: { note?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
        <Info className="size-4 text-emerald-500" />
        <h3 className="text-sm font-semibold">Listing unavailable</h3>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          {note ??
            "Edge function listing requires the Supabase Management API + a personal access token. The service_role key can't enumerate functions."}
        </p>
        <div className="rounded-md border border-border/60 bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <KeyRound className="size-3.5" />
            why
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The service_role JWT is scoped to a single project&apos;s data plane
            (auth, postgrest, storage, realtime). Management endpoints —
            including <span className="font-mono">/v1/projects/&hellip;/functions</span>{" "}
            — live behind <span className="font-mono">api.supabase.com</span>{" "}
            and require a personal access token instead.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          To browse functions, use the Supabase dashboard or the{" "}
          <span className="font-mono">supabase functions list</span> CLI.
        </p>
      </div>
    </div>
  );
}
