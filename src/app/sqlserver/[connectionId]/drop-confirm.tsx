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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export type DropTarget =
  | { kind: "database"; database: string }
  | { kind: "schema"; database: string; schema: string }
  | {
      kind: "object";
      database: string;
      schema: string;
      name: string;
      /** SqlObject kind: table | view | proc | scalar_fn | table_fn | trigger | synonym */
      objectKind: string;
    };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  target: DropTarget | null;
  onDropped: (target: DropTarget) => void;
}

// Friendly noun for an object kind.
const OBJECT_NOUN: Record<string, string> = {
  table: "table",
  view: "view",
  proc: "procedure",
  scalar_fn: "function",
  table_fn: "function",
  trigger: "trigger",
  synonym: "synonym",
};

function buildUrl(connectionId: string, t: DropTarget, force: boolean): string {
  const dbBase = `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(t.database)}`;
  if (t.kind === "database") {
    return `${dbBase}?force=${force}`;
  }
  if (t.kind === "schema") {
    return `${dbBase}/schemas/${encodeURIComponent(t.schema)}`;
  }
  return `${dbBase}/objects?schema=${encodeURIComponent(t.schema)}&name=${encodeURIComponent(t.name)}&kind=${encodeURIComponent(t.objectKind)}`;
}

function nounOf(t: DropTarget): string {
  if (t.kind === "database") return "database";
  if (t.kind === "schema") return "schema";
  return OBJECT_NOUN[t.objectKind] ?? "object";
}

function identOf(t: DropTarget): string {
  if (t.kind === "database") return t.database;
  if (t.kind === "schema") return t.schema;
  return `${t.schema}.${t.name}`;
}

export function DropConfirm({
  open,
  onOpenChange,
  connectionId,
  target,
  onDropped,
}: Props) {
  const [force, setForce] = useState(false);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setForce(false);
    setWorking(false);
  };

  const perform = async () => {
    if (!target) return;
    setWorking(true);
    try {
      const res = await fetch(buildUrl(connectionId, target, force), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Drop failed", { description: data.error });
        return;
      }
      toast.success(`Dropped ${nounOf(target)} “${identOf(target)}”`);
      onDropped(target);
      reset();
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  };

  const noun = target ? nounOf(target) : "object";

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
          <AlertDialogTitle>Drop {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            {target ? (
              <>
                This will permanently delete{" "}
                <span className="font-mono">{identOf(target)}</span>
                {target.kind !== "database" ? (
                  <>
                    {" "}from <span className="font-mono">{target.database}</span>
                  </>
                ) : null}
                . This cannot be undone.
                {target.kind === "schema" ? (
                  <> The schema must be empty.</>
                ) : null}
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {target?.kind === "database" ? (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[12.5px]">
            <Switch
              id="drop-force"
              size="sm"
              checked={force}
              disabled={working}
              onCheckedChange={setForce}
              className="data-checked:bg-destructive"
            />
            <Label htmlFor="drop-force" className="cursor-pointer font-normal">
              <span className="font-medium">Force</span>
              <span className="text-muted-foreground">
                {" — set SINGLE_USER and roll back active connections first"}
              </span>
            </Label>
          </div>
        ) : null}

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
            Drop{force ? " (FORCE)" : ""}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
