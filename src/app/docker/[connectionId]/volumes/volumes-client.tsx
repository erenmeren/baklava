"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";

interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  created?: string;
  scope?: string;
}

interface Props {
  connectionId: string;
}

export function VolumesClient({ connectionId }: Props) {
  const [volumes, setVolumes] = useState<VolumeSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<VolumeSummary | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/volumes`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setVolumes(data.volumes as VolumeSummary[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/docker/${connectionId}/volumes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Volume created");
        setOpen(false);
        setName("");
        await load();
      } else toast.error(data.error || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (v: VolumeSummary) => {
    setBusy(v.name);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/volumes/${encodeURIComponent(v.name)}?force=1`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Volume removed");
        await load();
      } else toast.error(data.error || "Could not remove");
    } finally {
      setBusy(null);
      setConfirmRemove(null);
    }
  };

  return (
    <WorkspacePage
      title="Volumes"
      description={
        volumes
          ? `${volumes.length} volume${volumes.length === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" />
            Create
          </Button>
        </>
      }
    >
      {volumes === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : volumes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No volumes.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Mountpoint</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {volumes.map((v) => (
                <TableRow key={v.name}>
                  <TableCell className="font-mono text-xs break-all">
                    {v.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.driver}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground break-all">
                    {v.mountpoint}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmRemove(v)}
                      disabled={busy === v.name}
                      title="Remove"
                    >
                      {busy === v.name ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create volume</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vol-name">Name</Label>
            <Input
              id="vol-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-volume"
              autoFocus
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmRemove)}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove volume?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the volume{" "}
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
    </WorkspacePage>
  );
}
