"use client";

import { useState } from "react";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export type DropTarget =
  | { kind: "database"; database: string }
  | {
      kind: "table";
      database: string;
      name: string;
      objectKind: "table" | "view";
      /** When true, run TRUNCATE instead of DROP. */
      truncate?: boolean;
    };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  target: DropTarget | null;
  onDropped: (target: DropTarget) => void;
}

function buildUrl(connectionId: string, target: DropTarget): string {
  if (target.kind === "database") {
    return `/api/mysql/${connectionId}/databases/${encodeURIComponent(target.database)}`;
  }
  const base = `/api/mysql/${connectionId}/databases/${encodeURIComponent(target.database)}/tables/${encodeURIComponent(target.name)}`;
  const params = new URLSearchParams({ kind: target.objectKind });
  if (target.truncate) params.set("action", "truncate");
  return `${base}?${params.toString()}`;
}

function targetLabel(target: DropTarget): string {
  if (target.kind === "database") return `database "${target.database}"`;
  return `${target.objectKind} "${target.database}.${target.name}"`;
}

export function DropConfirm({
  open,
  onOpenChange,
  connectionId,
  target,
  onDropped,
}: Props) {
  const [working, setWorking] = useState(false);

  const isTruncate = target?.kind === "table" && target.truncate === true;
  const actionWord = isTruncate ? "Truncate" : "Drop";

  const objectKindWord =
    target?.kind === "database"
      ? "database"
      : target?.objectKind === "view"
        ? "view"
        : "table";

  const perform = async () => {
    if (!target) return;
    setWorking(true);
    try {
      const res = await fetch(buildUrl(connectionId, target), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`${actionWord} failed`, { description: data.error });
        return;
      }
      toast.success(
        isTruncate
          ? `Truncated ${targetLabel(target)}`
          : `Dropped ${targetLabel(target)}`,
      );
      onDropped(target);
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!working) onOpenChange(v);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {actionWord} {objectKindWord}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target ? (
              isTruncate && target.kind === "table" ? (
                <>
                  This will permanently delete all rows in{" "}
                  <span className="font-mono">
                    {target.database}.{target.name}
                  </span>
                  . This cannot be undone.
                </>
              ) : (
                <>
                  This will permanently delete{" "}
                  <span className="font-mono">
                    {target.kind === "database"
                      ? target.database
                      : `${target.database}.${target.name}`}
                  </span>
                  {target.kind === "database" ? (
                    <> and all of its tables</>
                  ) : null}
                  . This cannot be undone.
                </>
              )
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              perform();
            }}
            disabled={working}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {actionWord}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
