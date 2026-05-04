"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import { RelativeTime } from "@/components/workspace/relative-time";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";

interface ServiceDetail {
  service: string;
  containerId: string;
  containerName: string;
  image: string;
  state: string;
  status: string;
  ports: { host?: number; container: number; protocol: string }[];
  createdAt: number;
}

interface StackDetail {
  name: string;
  services: ServiceDetail[];
  networks: { name: string; id: string; driver: string }[];
  volumes: { name: string; driver: string; mountpoint: string }[];
  createdAt: number;
}

interface Props {
  connectionId: string;
  name: string;
}

export function StackDetailClient({ connectionId, name }: Props) {
  const router = useRouter();
  const [data, setData] = useState<StackDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeVolumes, setRemoveVolumes] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/docker/${connectionId}/stacks/${encodeURIComponent(name)}`,
      { cache: "no-store" }
    );
    const body = await res.json();
    if (res.ok) setData(body as StackDetail);
    else if (res.status === 404) setData(null);
    else toast.error("Could not load", { description: body.error });
  }, [connectionId, name]);

  useEffect(() => {
    load();
    const i = setInterval(load, 4000);
    return () => clearInterval(i);
  }, [load]);

  const action = async (act: "start" | "stop" | "restart") => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/stacks/${encodeURIComponent(name)}/action`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: act }),
        }
      );
      const body = await res.json();
      if (res.ok) {
        toast.success(`Stack ${act}`, {
          description: `${body.services} service${body.services === 1 ? "" : "s"}`,
        });
        await load();
      } else toast.error(body.error || `Could not ${act}`);
    } finally {
      setBusy(false);
    }
  };

  const teardown = async () => {
    setBusy(true);
    try {
      const url = `/api/docker/${connectionId}/stacks/${encodeURIComponent(name)}${removeVolumes ? "?volumes=1" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const body = await res.json();
      if (res.ok) {
        toast.success("Stack removed");
        router.push(`/docker/${connectionId}/stacks`);
      } else toast.error(body.error || "Could not remove");
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const running = data?.services.filter((s) => s.state === "running").length ?? 0;
  const total = data?.services.length ?? 0;
  const allRunning = total > 0 && running === total;
  const noneRunning = running === 0;

  return (
    <WorkspacePage
      title={
        <span className="inline-flex items-baseline gap-2">
          {name}
          {data ? (
            <Badge
              variant={allRunning ? "default" : noneRunning ? "secondary" : "outline"}
              className="font-mono text-[11px]"
            >
              {running}/{total} running
            </Badge>
          ) : null}
        </span>
      }
      description={
        data ? (
          <span className="text-xs">
            {data.networks.length} network · {data.volumes.length} volume ·
            deployed <RelativeTime value={data.createdAt * 1000} />
          </span>
        ) : undefined
      }
      actions={
        <>
          <Link
            href={`/docker/${connectionId}/stacks`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          {allRunning ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => action("restart")}
                disabled={busy}
              >
                <RotateCcw className="size-3.5" />
                Restart
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => action("stop")}
                disabled={busy}
              >
                <Square className="size-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => action("start")}
              disabled={busy || total === 0}
            >
              <Play className="size-3.5" />
              Start all
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </>
      }
    >
      {!data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Services
            </h2>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Ports</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.services.map((s) => (
                    <TableRow key={s.containerId}>
                      <TableCell className="font-mono text-xs font-medium">
                        {s.service}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/docker/${connectionId}/containers/${s.containerId}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {s.containerName}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[28ch] truncate">
                        {s.image}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.state === "running" ? "default" : "secondary"}
                          className="font-mono"
                        >
                          {s.state}
                        </Badge>
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[20ch]">
                          {s.status}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.ports.length === 0 ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          s.ports
                            .map((p) =>
                              p.host
                                ? `${p.host}→${p.container}/${p.protocol}`
                                : `${p.container}/${p.protocol}`
                            )
                            .join(", ")
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {data.networks.length > 0 ? (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Networks
              </h2>
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.networks.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-mono text-xs">{n.name}</TableCell>
                        <TableCell className="font-mono text-xs">{n.driver}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {n.id.slice(0, 12)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}

          {data.volumes.length > 0 ? (
            <section>
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Volumes
              </h2>
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Mountpoint</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.volumes.map((v) => (
                      <TableRow key={v.name}>
                        <TableCell className="font-mono text-xs">{v.name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {v.driver}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground break-all">
                          {v.mountpoint}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </div>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove stack {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All containers in the stack will be force-removed, along with the
              stack&rsquo;s networks. Volumes are kept by default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={removeVolumes}
              onChange={(e) => setRemoveVolumes(e.target.checked)}
            />
            Also remove volumes (data loss — cannot be undone)
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={teardown} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
