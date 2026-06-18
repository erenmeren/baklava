"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CollectionSummary } from "@/lib/connections/qdrant";

interface Props {
  connectionId: string;
  initial:
    | { ok: true; collections: CollectionSummary[] }
    | { ok: false; error: string };
}

const STATUS_COLORS: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  yellow: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  grey: "bg-muted text-muted-foreground",
};

function statusClass(status: string) {
  return STATUS_COLORS[status.toLowerCase()] ?? STATUS_COLORS.grey;
}

export function CollectionsClient({ connectionId, initial }: Props) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // New collection dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newDistance, setNewDistance] = useState("Cosine");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/qdrant/${connectionId}/collections/${encodeURIComponent(deleteTarget)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error("Delete failed", { description: data.error });
      } else {
        toast.success(`Deleted "${deleteTarget}"`);
        setDeleteTarget(null);
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const size = parseInt(newSize, 10);
    if (!newName.trim() || !size || size < 1) {
      setCreateError("Name and a positive vector size are required.");
      return;
    }
    setCreateError(null);
    setCreating(true);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/qdrant/${connectionId}/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), size, distance: newDistance }),
        signal: ac.signal,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setCreateError(data.error ?? "Unknown error");
      } else {
        toast.success(`Created "${newName.trim()}"`);
        setNewOpen(false);
        setNewName("");
        setNewSize("");
        setNewDistance("Cosine");
        router.refresh();
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setCreateError((err as Error).message);
      }
    } finally {
      setCreating(false);
    }
  };

  if (!initial.ok) {
    return (
      <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
        {initial.error}
      </div>
    );
  }

  const { collections } = initial;

  return (
    <>
      {/* New collection button */}
      <div className="mb-4 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCreateError(null);
            setNewOpen(true);
          }}
        >
          <Plus className="size-3.5 mr-1.5" />
          New collection
        </Button>
      </div>

      {/* Grid */}
      {collections.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No collections yet. Create one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {collections.map((c) => {
            const href = `/qdrant/${connectionId}/collections/${encodeURIComponent(c.name)}`;
            return (
              <div key={c.name} className="relative group">
                <Link
                  href={href}
                  className="block border border-border/60 rounded-md p-4 hover:border-rose-500/40 hover:bg-rose-500/[0.03] transition-colors"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className="font-mono text-sm font-medium truncate"
                      title={c.name}
                    >
                      {c.name}
                    </h3>
                    <span
                      className={cn(
                        "shrink-0 text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 rounded font-medium",
                        statusClass(c.status),
                      )}
                    >
                      {c.status}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="mt-3 flex items-end justify-between text-[11px]">
                    <span className="text-muted-foreground tabular-nums">
                      {c.pointsCount.toLocaleString()}{" "}
                      <span className="text-[9px] uppercase tracking-[0.18em]">
                        pts
                      </span>
                    </span>
                    <span className="font-mono text-muted-foreground/80">
                      {c.namedVectors.length > 0
                        ? `${c.namedVectors.length} named vecs`
                        : c.vectorSize !== null
                          ? `${c.vectorSize}d · ${c.distance ?? "?"}`
                          : "—"}
                    </span>
                  </div>
                </Link>

                {/* Delete button — overlaid, stops card navigation */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(c.name);
                  }}
                  title={`Delete "${c.name}"`}
                  className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 hover:text-red-500 text-muted-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  <span className="font-mono">{deleteTarget}</span> and all its
                  points will be permanently removed from Qdrant. This cannot be
                  undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New collection dialog */}
      <Dialog open={newOpen} onOpenChange={(v) => { if (!creating) setNewOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>
              Create a new Qdrant collection with a fixed vector configuration.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="col-name">Name</Label>
              <Input
                id="col-name"
                placeholder="my_collection"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={creating}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-size">Vector size</Label>
              <Input
                id="col-size"
                type="number"
                placeholder="1536"
                min={1}
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-distance">Distance metric</Label>
              <Select
                value={newDistance}
                onValueChange={(v) => setNewDistance(v ?? "Cosine")}
                disabled={creating}
              >
                <SelectTrigger id="col-distance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cosine">Cosine</SelectItem>
                  <SelectItem value="Dot">Dot</SelectItem>
                  <SelectItem value="Euclid">Euclid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createError ? (
              <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs px-3 py-2">
                {createError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
