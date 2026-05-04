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
  DialogDescription,
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
import { RelativeTime } from "@/components/workspace/relative-time";
import { formatBytes } from "@/components/workspace/format";
import { HubSearchDialog } from "./hub-search-dialog";
import { BuildImageDialog } from "./build-image-dialog";
import { toast } from "sonner";
import {
  Download,
  Hammer,
  Loader2,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

interface ImageSummary {
  id: string;
  shortId: string;
  repoTags: string[];
  size: number;
  created: number;
}

interface Props {
  connectionId: string;
}

export function ImagesClient({ connectionId }: Props) {
  const [images, setImages] = useState<ImageSummary[] | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullRef, setPullRef] = useState("alpine:latest");
  const [pulling, setPulling] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ImageSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docker/${connectionId}/images`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setImages(data.images as ImageSummary[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const pull = async () => {
    if (!pullRef.trim()) return;
    setPulling(true);
    try {
      const res = await fetch(`/api/docker/${connectionId}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: pullRef.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Image pulled", { description: pullRef });
        setPullOpen(false);
        await load();
      } else toast.error(data.error || "Pull failed");
    } finally {
      setPulling(false);
    }
  };

  const remove = async (img: ImageSummary) => {
    setBusyId(img.id);
    try {
      const ref = img.repoTags[0] || img.id;
      const res = await fetch(
        `/api/docker/${connectionId}/images/${encodeURIComponent(ref)}?force=1`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Image removed");
        await load();
      } else toast.error(data.error || "Could not remove");
    } finally {
      setBusyId(null);
      setConfirmRemove(null);
    }
  };

  return (
    <WorkspacePage
      title="Images"
      description={
        images
          ? `${images.length} image${images.length === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => setHubOpen(true)}>
            <Search className="size-3.5" />
            Search Hub
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBuildOpen(true)}
          >
            <Hammer className="size-3.5" />
            Build
          </Button>
          <Button size="sm" onClick={() => setPullOpen(true)}>
            <Download className="size-3.5" />
            Pull by ref
          </Button>
        </>
      }
    >
      {images === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No images yet. Pull one to get started.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository:Tag</TableHead>
                <TableHead>Image ID</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {images.map((img) => (
                <TableRow key={img.id}>
                  <TableCell className="font-mono text-xs">
                    {img.repoTags.length > 1 ? (
                      <div className="space-y-0.5">
                        {img.repoTags.map((t) => (
                          <div key={t}>{t}</div>
                        ))}
                      </div>
                    ) : (
                      img.repoTags[0]
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {img.shortId}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatBytes(img.size)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <RelativeTime value={img.created} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmRemove(img)}
                      disabled={busyId === img.id}
                      title="Remove"
                    >
                      {busyId === img.id ? (
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

      <HubSearchDialog
        connectionId={connectionId}
        open={hubOpen}
        onOpenChange={setHubOpen}
        onPullComplete={load}
      />

      <BuildImageDialog
        connectionId={connectionId}
        open={buildOpen}
        onOpenChange={setBuildOpen}
        onBuilt={load}
      />

      <Dialog open={pullOpen} onOpenChange={setPullOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pull image</DialogTitle>
            <DialogDescription>
              From Docker Hub or any reachable registry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pull-ref">Image reference</Label>
            <Input
              id="pull-ref"
              value={pullRef}
              onChange={(e) => setPullRef(e.target.value)}
              placeholder="alpine:latest"
              spellCheck={false}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPullOpen(false)}
              disabled={pulling}
            >
              Cancel
            </Button>
            <Button onClick={pull} disabled={pulling || !pullRef.trim()}>
              {pulling ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Pull
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmRemove)}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove image?</AlertDialogTitle>
            <AlertDialogDescription>
              This will force-remove{" "}
              <span className="font-mono">
                {confirmRemove?.repoTags[0] || confirmRemove?.shortId}
              </span>
              .
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
