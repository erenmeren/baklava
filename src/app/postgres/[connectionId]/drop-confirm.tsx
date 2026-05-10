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
  | { kind: "schema"; database: string; schema: string }
  | { kind: "table"; database: string; schema: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  target: DropTarget | null;
  onDropped: (target: DropTarget) => void;
}

function buildUrl(connectionId: string, target: DropTarget, cascade: boolean): string {
  if (target.kind === "database") {
    return `/api/postgres/${connectionId}/databases/${encodeURIComponent(target.database)}?force=${cascade}`;
  }
  const base = `/api/postgres/${connectionId}/databases/${encodeURIComponent(target.database)}/schemas/${encodeURIComponent(target.schema)}`;
  if (target.kind === "schema") {
    return `${base}?cascade=${cascade}`;
  }
  return `${base}/tables/${encodeURIComponent(target.name)}?cascade=${cascade}`;
}

function targetLabel(target: DropTarget): string {
  if (target.kind === "database") return `database "${target.database}"`;
  if (target.kind === "schema") return `schema "${target.schema}"`;
  return `table "${target.schema}.${target.name}"`;
}

export function DropConfirm({
  open,
  onOpenChange,
  connectionId,
  target,
  onDropped,
}: Props) {
  const [cascade, setCascade] = useState(false);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setCascade(false);
    setWorking(false);
  };

  const perform = async () => {
    if (!target) return;
    setWorking(true);
    try {
      const res = await fetch(buildUrl(connectionId, target, cascade), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Drop failed", { description: data.error });
        return;
      }
      toast.success(`Dropped ${targetLabel(target)}`);
      onDropped(target);
      reset();
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };

  const objectKindWord =
    target?.kind === "database"
      ? "database"
      : target?.kind === "schema"
        ? "schema"
        : "table";

  const cascadeLabel =
    target?.kind === "database"
      ? "force"
      : "cascade";

  const cascadeHint =
    target?.kind === "database"
      ? "terminate active connections to this database before dropping"
      : target?.kind === "schema"
        ? "tables, views, functions in this schema"
        : "views, foreign keys referencing this table";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !working) reset();
        onOpenChange(v);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Drop {objectKindWord}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target ? (
              <>
                This will permanently delete{" "}
                <span className="font-mono">
                  {target.kind === "database"
                    ? target.database
                    : target.kind === "schema"
                      ? target.schema
                      : `${target.schema}.${target.name}`}
                </span>
                {target.kind !== "database" ? (
                  <>
                    {" "}from{" "}
                    <span className="font-mono">{target.database}</span>
                  </>
                ) : null}
                . This cannot be undone.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex items-center gap-2 select-none rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={cascade}
            disabled={working}
            onChange={(e) => setCascade(e.target.checked)}
            className="size-3.5 accent-destructive"
          />
          <span>
            <span className="font-medium capitalize">{cascadeLabel}</span>
            <span className="text-muted-foreground">
              {" — "}
              {target?.kind === "database"
                ? cascadeHint
                : `also drop dependent objects (${cascadeHint})`}
            </span>
          </span>
        </label>

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
            Drop{cascade ? ` (${cascadeLabel.toUpperCase()})` : ""}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
