"use client";

import { useCallback, useEffect, useState } from "react";
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
import { formatBytes } from "@/components/workspace/format";
import { toast } from "sonner";
import {
  Container as ContainerIcon,
  Box,
  HardDrive,
  Network,
  Cpu,
  Layers,
  Trash2,
  Loader2,
} from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface SystemInfo {
  serverVersion: string;
  apiVersion: string;
  os: string;
  osType: string;
  arch: string;
  kernel: string;
  cpus: number;
  memTotal: number;
  storageDriver: string;
  containers: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  rootDir: string;
  name: string;
}

type PruneTarget = "containers" | "images" | "volumes" | "networks" | "build";

const PRUNE_LABELS: Record<PruneTarget, string> = {
  containers: "stopped containers",
  images: "dangling images",
  volumes: "unused volumes",
  networks: "unused networks",
  build: "build cache",
};

interface Props {
  connectionId: string;
}

export function SystemClient({ connectionId }: Props) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [confirmPrune, setConfirmPrune] = useState<PruneTarget | null>(null);
  const [pruning, setPruning] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/system/info`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setInfo(data as SystemInfo);
    else toast.error("Could not load system info", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const prune = async (resource: PruneTarget) => {
    setPruning(true);
    try {
      const res = await fetch(`/api/docker/${connectionId}/system/prune`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource }),
      });
      const data = await res.json();
      if (res.ok) {
        const reclaimed =
          data.spaceReclaimed > 0
            ? ` · reclaimed ${formatBytes(data.spaceReclaimed)}`
            : "";
        const count = data.itemsDeleted?.length || 0;
        toast.success(`Pruned ${PRUNE_LABELS[resource]}`, {
          description: `${count} item${count === 1 ? "" : "s"} removed${reclaimed}`,
        });
        await load();
      } else {
        toast.error(data.error || "Prune failed");
      }
    } finally {
      setPruning(false);
      setConfirmPrune(null);
    }
  };

  return (
    <WorkspacePage
      title="System"
      description={info ? `${info.name} · ${info.os}` : undefined}
      actions={<RefreshButton onClick={load} />}
    >
      {!info ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Top KPI row */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              icon={<ContainerIcon className="size-4" />}
              label="Containers"
              value={info.containers}
              sub={`${info.containersRunning} running · ${info.containersStopped} stopped`}
            />
            <Kpi
              icon={<Box className="size-4" />}
              label="Images"
              value={info.images}
            />
            <Kpi
              icon={<Cpu className="size-4" />}
              label="CPUs"
              value={info.cpus}
              sub={`${formatBytes(info.memTotal)} total memory`}
            />
            <Kpi
              icon={<Layers className="size-4" />}
              label="Server"
              value={info.serverVersion}
              sub={`API ${info.apiVersion}`}
            />
          </div>

          {/* Daemon details */}
          <section className="rounded-lg border border-border/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 bg-muted/20">
              <h2 className="text-sm font-semibold">Daemon</h2>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-[200px_1fr] divide-y divide-border/40">
              <Row label="Hostname" value={info.name} />
              <Row label="OS" value={info.os} />
              <Row label="Kernel" value={info.kernel} />
              <Row
                label="Architecture"
                value={`${info.arch} (${info.osType})`}
              />
              <Row label="Storage driver" value={info.storageDriver} />
              <Row label="Root dir" value={info.rootDir} />
              <Row label="Server version" value={info.serverVersion} />
              <Row label="API version" value={info.apiVersion} />
            </dl>
          </section>

          {/* Prune */}
          <section className="rounded-lg border border-border/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 bg-muted/20 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Reclaim disk</h2>
              <p className="text-xs text-muted-foreground">
                Removes unused resources. Cannot be undone.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
              <PruneCard
                icon={<ContainerIcon className="size-4" />}
                label="Containers"
                description="Remove all stopped containers."
                onClick={() => setConfirmPrune("containers")}
              />
              <PruneCard
                icon={<Box className="size-4" />}
                label="Images"
                description="Remove dangling images (no tag, no container reference)."
                onClick={() => setConfirmPrune("images")}
              />
              <PruneCard
                icon={<HardDrive className="size-4" />}
                label="Volumes"
                description="Remove volumes not used by any container."
                onClick={() => setConfirmPrune("volumes")}
              />
              <PruneCard
                icon={<Network className="size-4" />}
                label="Networks"
                description="Remove user-defined networks not used by any container."
                onClick={() => setConfirmPrune("networks")}
              />
              <PruneCard
                icon={<Layers className="size-4" />}
                label="Build cache"
                description="Remove BuildKit cache (does not affect images)."
                onClick={() => setConfirmPrune("build")}
              />
            </div>
          </section>
        </div>
      )}

      <AlertDialog
        open={Boolean(confirmPrune)}
        onOpenChange={(o) => !o && !pruning && setConfirmPrune(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Prune {confirmPrune ? PRUNE_LABELS[confirmPrune] : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all{" "}
              {confirmPrune ? PRUNE_LABELS[confirmPrune] : ""} on this Docker
              host. There is no way to recover them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pruning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmPrune && prune(confirmPrune)}
              disabled={pruning}
            >
              {pruning ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Prune
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-mono">
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {sub ? (
        <div className="text-[11px] text-muted-foreground font-mono">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt className="px-4 py-2.5 text-xs text-muted-foreground bg-muted/10 sm:bg-transparent">
        {label}
      </dt>
      <dd className="px-4 py-2.5 font-mono text-xs break-all">{value}</dd>
    </>
  );
}

function PruneCard({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-4 flex flex-col gap-3 hover:border-destructive/40 transition-colors">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium text-sm">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground flex-1">{description}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        className="self-start"
      >
        <Trash2 className="size-3.5" />
        Prune
      </Button>
    </div>
  );
}
