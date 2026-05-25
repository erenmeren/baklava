"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { RelativeTime } from "@/components/workspace/relative-time";
import {
  AutoRefresh,
  DEFAULT_REFRESH_INTERVALS,
} from "@/components/workspace/auto-refresh";
import { CreateContainerDialog } from "./create-container-dialog";
import { ContainerLogsDock } from "./container-logs-dock";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  Plus,
  ScrollText,
  Square,
  RotateCcw,
  Trash2,
} from "lucide-react";

interface ContainerSummary {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: { ip?: string; private: number; public?: number; type: string }[];
}

type Action = "start" | "stop" | "restart";

interface Props {
  connectionId: string;
}

export function ContainersClient({ connectionId }: Props) {
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmRemove, setConfirmRemove] = useState<ContainerSummary | null>(
    null
  );
  const [logsFor, setLogsFor] = useState<ContainerSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers?all=${showAll ? "1" : "0"}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setContainers(data.containers as ContainerSummary[]);
      else toast.error("Could not load", { description: data.error });
    } catch (e) {
      toast.error("Request failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [connectionId, showAll]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the docked logs panel's header in sync with poll updates.
  useEffect(() => {
    if (!logsFor || !containers) return;
    const fresh = containers.find((c) => c.id === logsFor.id);
    if (!fresh) {
      setLogsFor(null);
      return;
    }
    if (fresh.state !== logsFor.state || fresh.status !== logsFor.status) {
      setLogsFor(fresh);
    }
  }, [containers, logsFor]);

  const setBusyFor = (id: string, value: boolean) =>
    setBusy((b) => ({ ...b, [id]: value }));

  const act = async (cid: string, action: Action) => {
    setBusyFor(cid, true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${cid}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Container ${action}`);
        await load();
      } else {
        toast.error(data.error || `Could not ${action}`);
      }
    } finally {
      setBusyFor(cid, false);
    }
  };

  const remove = async (c: ContainerSummary) => {
    setBusyFor(c.id, true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/containers/${c.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Container removed");
        await load();
      } else {
        toast.error(data.error || "Could not remove");
      }
    } finally {
      setBusyFor(c.id, false);
      setConfirmRemove(null);
    }
  };

  const formatPorts = (c: ContainerSummary) => {
    if (!c.ports.length) return null;
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const p of c.ports) {
      const key =
        p.public != null
          ? `${p.public}->${p.private}/${p.type}`
          : `${p.private}/${p.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(key);
      }
    }
    return parts.join(", ");
  };

  const description = containers
    ? `${containers.length} container${
        containers.length === 1 ? "" : "s"
      }${showAll ? "" : " running"}`
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-6 py-4 border-b border-border/60 flex items-start justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">Containers</h1>
          {description ? (
            <p className="text-sm text-muted-foreground mt-0.5">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              id="show-all-containers"
              size="sm"
              checked={showAll}
              onCheckedChange={setShowAll}
            />
            <Label
              htmlFor="show-all-containers"
              className="cursor-pointer text-sm font-normal text-muted-foreground"
            >
              Include stopped
            </Label>
          </div>
          <AutoRefresh
            intervalMs={5_000}
            intervals={DEFAULT_REFRESH_INTERVALS}
            onTick={load}
            loading={containers === null}
          />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            Create
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-6">
      {containers === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : containers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No containers found.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Ports</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {containers.map((c) => {
                const isRunning = c.state === "running";
                const isBusy = busy[c.id];
                const isOpenLogs = logsFor?.id === c.id;
                return (
                  <TableRow
                    key={c.id}
                    className={cn(
                      "transition-colors",
                      isOpenLogs &&
                        "bg-brand/[0.06] hover:bg-brand/[0.08] data-[state=selected]:bg-brand/10",
                    )}
                  >
                    <TableCell>
                      <Link
                        href={`/docker/${connectionId}/containers/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {c.shortId}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[28ch] truncate">
                      {c.image}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={isRunning ? "default" : "secondary"}
                        className="font-mono"
                      >
                        {c.state}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[20ch]">
                        {c.status}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[20ch] truncate">
                      {formatPorts(c) || (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <RelativeTime value={c.created} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setLogsFor((prev) =>
                              prev?.id === c.id ? null : c,
                            )
                          }
                          title={
                            isOpenLogs ? "Close logs panel" : "View logs"
                          }
                          aria-label={
                            isOpenLogs ? "Close logs panel" : "View logs"
                          }
                          aria-pressed={isOpenLogs}
                          className={cn(
                            "group/logs relative inline-flex size-7 items-center justify-center rounded-md",
                            "transition-colors duration-150",
                            isOpenLogs
                              ? "bg-brand/15 text-brand ring-1 ring-brand/40 shadow-[0_0_10px_-2px_oklch(from_var(--brand)_l_c_h/0.45)]"
                              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]",
                          )}
                        >
                          <ScrollText className="size-3.5" />
                          {isOpenLogs ? (
                            <span
                              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-brand status-pulse"
                              aria-hidden
                            />
                          ) : null}
                        </button>
                        {isRunning ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => act(c.id, "restart")}
                              disabled={isBusy}
                              title="Restart"
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => act(c.id, "stop")}
                              disabled={isBusy}
                              title="Stop"
                            >
                              <Square className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => act(c.id, "start")}
                            disabled={isBusy}
                            title="Start"
                          >
                            <Play className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setConfirmRemove(c)}
                          disabled={isBusy}
                          title="Remove"
                        >
                          {isBusy ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      </div>

      {logsFor ? (
        <ContainerLogsDock
          connectionId={connectionId}
          container={logsFor}
          onClose={() => setLogsFor(null)}
        />
      ) : null}

      <CreateContainerDialog
        connectionId={connectionId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
      />

      <AlertDialog
        open={Boolean(confirmRemove)}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove container?</AlertDialogTitle>
            <AlertDialogDescription>
              This will force-remove{" "}
              <span className="font-mono">{confirmRemove?.name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemove && remove(confirmRemove)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
