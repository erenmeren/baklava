"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

interface Topic {
  name: string;
  partitions: number;
  replicas: number;
  internal: boolean;
}

interface Props {
  connectionId: string;
}

export function TopicsClient({ connectionId }: Props) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPartitions, setCreatePartitions] = useState("1");
  const [createRf, setCreateRf] = useState("1");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Topic | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/kafka/${connectionId}/topics${includeInternal ? "?internal=1" : ""}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (res.ok) setTopics(data.topics as Topic[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId, includeInternal]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/kafka/${connectionId}/topics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          partitions: Number(createPartitions),
          replicationFactor: Number(createRf),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Topic created");
        setCreateOpen(false);
        setCreateName("");
        await load();
      } else toast.error(data.error || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (t: Topic) => {
    setBusy(t.name);
    try {
      const res = await fetch(
        `/api/kafka/${connectionId}/topics/${encodeURIComponent(t.name)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Topic deleted");
        await load();
      } else toast.error(data.error || "Could not delete");
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  };

  return (
    <WorkspacePage
      title="Topics"
      description={
        topics
          ? `${topics.length} topic${topics.length === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeInternal}
              onChange={(e) => setIncludeInternal(e.target.checked)}
              className="size-3.5"
            />
            Show internal
          </label>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New topic
          </Button>
        </>
      }
    >
      {topics === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : topics.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No topics. Create one to get started.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Partitions</TableHead>
                <TableHead>Replicas</TableHead>
                <TableHead></TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topics.map((t) => (
                <TableRow key={t.name}>
                  <TableCell>
                    <Link
                      href={`/kafka/${connectionId}/topics/${encodeURIComponent(t.name)}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.partitions}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.replicas}
                  </TableCell>
                  <TableCell>
                    {t.internal ? (
                      <Badge variant="secondary">internal</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmDelete(t)}
                      disabled={busy === t.name || t.internal}
                      title={t.internal ? "Cannot delete internal" : "Delete"}
                    >
                      {busy === t.name ? (
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create topic</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic-name">Name</Label>
              <Input
                id="topic-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-topic"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="topic-partitions">Partitions</Label>
                <Input
                  id="topic-partitions"
                  value={createPartitions}
                  onChange={(e) => setCreatePartitions(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="topic-rf">Replication factor</Label>
                <Input
                  id="topic-rf"
                  value={createRf}
                  onChange={(e) => setCreateRf(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={create}
              disabled={creating || !createName.trim()}
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete topic{" "}
              <span className="font-mono">{confirmDelete?.name}</span> and all
              its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
