"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RelativeTime } from "@/components/workspace/relative-time";
import {
  AutoRefresh,
  DEFAULT_REFRESH_INTERVALS,
} from "@/components/workspace/auto-refresh";
import { toast } from "sonner";
import { Plus, Layers } from "lucide-react";

interface StackSummary {
  name: string;
  services: number;
  running: number;
  total: number;
  createdAt: number;
}

interface Props {
  connectionId: string;
}

export function StacksClient({ connectionId }: Props) {
  const [stacks, setStacks] = useState<StackSummary[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/stacks`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setStacks(data.stacks as StackSummary[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspacePage
      title="Stacks"
      description={
        stacks
          ? `${stacks.length} stack${stacks.length === 1 ? "" : "s"} deployed`
          : undefined
      }
      actions={
        <>
          <AutoRefresh
            intervalMs={5_000}
            intervals={DEFAULT_REFRESH_INTERVALS}
            onTick={load}
            loading={stacks === null}
          />
          <Link
            href={`/docker/${connectionId}/stacks/new`}
            className="inline-flex items-center gap-1 text-sm rounded-md px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-3.5" />
            New stack
          </Link>
        </>
      }
    >
      {stacks === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : stacks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground text-sm space-y-3">
          <Layers className="size-8 mx-auto text-brand/60" />
          <p>No stacks deployed yet.</p>
          <Link
            href={`/docker/${connectionId}/stacks/new`}
            className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
          >
            Paste a docker-compose.yml to deploy your first stack →
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stacks.map((s) => {
                const allRunning = s.running === s.total && s.total > 0;
                const noneRunning = s.running === 0;
                return (
                  <TableRow key={s.name}>
                    <TableCell>
                      <Link
                        href={`/docker/${connectionId}/stacks/${encodeURIComponent(s.name)}`}
                        className="font-medium hover:underline inline-flex items-center gap-2"
                      >
                        <Layers className="size-3.5 text-brand" />
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.services}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          allRunning
                            ? "default"
                            : noneRunning
                              ? "secondary"
                              : "outline"
                        }
                        className="font-mono"
                      >
                        {s.running}/{s.total} running
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <RelativeTime value={s.createdAt * 1000} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </WorkspacePage>
  );
}
