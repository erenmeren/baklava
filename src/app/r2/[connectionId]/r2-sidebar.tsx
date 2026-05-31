"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Database,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface BucketInfo {
  name: string;
  createdAt: number | null;
}

interface Props {
  connectionId: string;
  defaultBucket: string;
}

export function R2Sidebar({ connectionId, defaultBucket }: Props) {
  const pathname = usePathname();
  const [buckets, setBuckets] = useState<BucketInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [working, setWorking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/r2/${connectionId}/buckets`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setBuckets(data.buckets as BucketInfo[]);
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const base = `/r2/${connectionId}`;
  const overviewActive = pathname === base;

  const createBucket = async () => {
    setWorking(true);
    try {
      const res = await fetch(`/api/r2/${connectionId}/buckets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Created ${newName}`);
        setCreateOpen(false);
        setNewName("");
        load();
      } else {
        toast.error("Create failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const deleteBucket = async (name: string) => {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/r2/${connectionId}/buckets/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Deleted ${name}`);
        setDeleteTarget(null);
        load();
      } else {
        toast.error("Delete failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-1 select-none">
      <Link
        href={base}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono transition-colors",
          overviewActive
            ? "bg-foreground/10 text-foreground font-medium"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <Database className="size-3 shrink-0" />
        Overview
      </Link>

      <div className="flex items-center justify-between px-2 py-1 pt-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Boxes className="size-3" />
          Buckets
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setCreateOpen(true)}
            title="New bucket"
          >
            <Plus className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={load}
            title="Refresh"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCcw className="size-3" />
            )}
          </Button>
        </div>
      </div>

      {buckets === null ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
      ) : buckets.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">(no buckets)</div>
      ) : (
        <ul>
          {buckets.map((b) => {
            const href = `${base}/buckets/${encodeURIComponent(b.name)}`;
            const active = pathname.startsWith(href);
            return (
              <li
                key={b.name}
                className={cn(
                  "group/b flex items-center pr-1 rounded-md transition-colors",
                  active ? "bg-foreground/10" : "hover:bg-foreground/5",
                )}
              >
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs font-mono",
                    active ? "text-foreground font-medium" : "text-muted-foreground",
                    b.name === defaultBucket && "italic",
                  )}
                >
                  <Boxes className="size-3 shrink-0" />
                  <span className="truncate">{b.name}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="opacity-0 group-hover/b:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground outline-none"
                    title="Bucket actions"
                  >
                    <MoreHorizontal className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setDeleteTarget(b.name)}
                      className="text-destructive focus:text-destructive"
                    >
                      Delete bucket…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={(v) => !working && setCreateOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New bucket</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="my-bucket"
            spellCheck={false}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button onClick={createBucket} disabled={working || !newName.trim()}>
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && !working && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bucket?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  Permanently delete bucket{" "}
                  <span className="font-mono">{deleteTarget}</span>. The bucket
                  must be empty or R2 will reject the request.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteBucket(deleteTarget);
              }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
