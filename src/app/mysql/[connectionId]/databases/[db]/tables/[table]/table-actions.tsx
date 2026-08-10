"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/workspace/confirm-dialog";
import { toast } from "sonner";

/**
 * The three destructive table-level actions MySQL offers, behind one dialog.
 * A single `action` slot rather than three booleans: they're mutually
 * exclusive, they share the working flag, and they share the request
 * plumbing.
 */
export type TableAction =
  | { kind: "truncate" }
  | { kind: "drop-table" }
  | { kind: "drop-index"; name: string }
  | null;

export function TableActionDialog({
  base,
  table,
  action,
  onClose,
  onDone,
}: {
  /** `/api/mysql/<id>/databases/<db>/tables/<table>` */
  base: string;
  table: string;
  action: TableAction;
  onClose: () => void;
  /** Called after the request succeeds, with the action that ran. */
  onDone: (kind: NonNullable<TableAction>["kind"]) => void;
}) {
  const [working, setWorking] = useState(false);

  const specs = {
    truncate: {
      title: "Truncate table?",
      description: (
        <>
          This will run <span className="font-mono">TRUNCATE TABLE {table}</span> and delete{" "}
          <strong>every row</strong>. This cannot be undone.
        </>
      ),
      confirmLabel: "Truncate",
      url: `${base}?action=truncate`,
      ok: "Table truncated",
      fail: "Truncate failed",
      keepWorking: false,
    },
    "drop-table": {
      title: "Drop table?",
      description: (
        <>
          This will run <span className="font-mono">DROP TABLE {table}</span> and remove the
          table and all its data. This cannot be undone.
        </>
      ),
      confirmLabel: "Drop table",
      url: `${base}?kind=table`,
      ok: "Table dropped",
      fail: "Drop failed",
      // The caller navigates away on success, so leave the spinner up rather
      // than flashing an enabled button on a page that's about to unmount.
      keepWorking: true,
    },
    "drop-index": {
      title: "Drop index?",
      description: (
        <>
          This will run{" "}
          <span className="font-mono">
            ALTER TABLE {table} DROP INDEX {action?.kind === "drop-index" ? action.name : ""}
          </span>
          . This cannot be undone.
        </>
      ),
      confirmLabel: "Drop",
      url:
        action?.kind === "drop-index"
          ? `${base}/indexes/${encodeURIComponent(action.name)}`
          : "",
      ok: "Index dropped",
      fail: "Drop failed",
      keepWorking: false,
    },
  } as const;

  const spec = action ? specs[action.kind] : null;

  async function confirm() {
    if (!action || !spec) return;
    setWorking(true);
    try {
      const res = await fetch(spec.url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(spec.fail, { description: data.error });
        setWorking(false);
        return;
      }
      toast.success(spec.ok);
      onDone(action.kind);
      onClose();
      if (!spec.keepWorking) setWorking(false);
    } catch (err) {
      toast.error(spec.fail, { description: err instanceof Error ? err.message : String(err) });
      setWorking(false);
    }
  }

  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={onClose}
      title={spec?.title ?? ""}
      description={spec?.description ?? null}
      confirmLabel={spec?.confirmLabel ?? ""}
      working={working}
      onConfirm={() => void confirm()}
    />
  );
}
