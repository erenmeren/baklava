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

/**
 * The Postgres Indexes tab's two per-row actions. Both live here rather than
 * in the client because they're per-tech panels in the L2 sense: the shell
 * knows nothing about ALTER INDEX, and the client is a descriptor plus its
 * dialogs.
 */
export function IndexActionDialogs({
  base,
  schema,
  renameTarget,
  dropTarget,
  onClose,
  onChanged,
}: {
  /** `/api/postgres/<id>/databases/<db>/schemas/<schema>/tables/<table>` */
  base: string;
  schema: string;
  renameTarget: string | null;
  dropTarget: string | null;
  onClose: () => void;
  /** Called after a successful rename or drop, to refetch the index list. */
  onChanged: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  async function submit(
    url: string,
    init: RequestInit,
    okMessage: string,
    failMessage: string,
  ) {
    setWorking(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) {
        toast.error(failMessage, { description: data.error });
        return;
      }
      toast.success(okMessage);
      onChanged();
      onClose();
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <AlertDialog
        open={renameTarget !== null}
        onOpenChange={(v) => {
          if (v) setRenameValue(renameTarget ?? "");
          else if (!working) onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename index</AlertDialogTitle>
            <AlertDialogDescription>
              ALTER INDEX{" "}
              <span className="font-mono">
                {schema}.{renameTarget}
              </span>{" "}
              RENAME TO …
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            disabled={working}
            spellCheck={false}
            className="font-mono h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
            placeholder="new_index_name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!renameTarget || !renameValue.trim()) return;
                void submit(
                  `${base}/indexes/${encodeURIComponent(renameTarget)}`,
                  {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ newName: renameValue.trim() }),
                  },
                  "Index renamed",
                  "Rename failed",
                );
              }}
              disabled={working || !renameValue.trim()}
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(v) => {
          if (!v && !working) onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop index?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">
                DROP INDEX {schema}.{dropTarget}
              </span>
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!dropTarget) return;
                void submit(
                  `${base}/indexes/${encodeURIComponent(dropTarget)}`,
                  { method: "DELETE" },
                  "Index dropped",
                  "Drop failed",
                );
              }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
