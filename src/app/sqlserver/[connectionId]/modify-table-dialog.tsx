"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
  ctaGlow,
} from "@/components/workspace/dialog-shell";

/**
 * Inline column editor for a SQL Server table. Mirrors the Postgres
 * ModifyTableDialog but emits T-SQL ALTER ops via PATCH:
 *
 *   /api/sqlserver/[id]/databases/[db]/tables/[schema]/[table]
 *
 * Diff computed locally so the user sees a live "N statements on apply"
 * counter and can preview the generated T-SQL before submitting.
 *
 * Note: in T-SQL, ALTER COLUMN must always re-state the type even when
 * only nullability is changing. So this dialog collapses "type +
 * nullable" into a single alterColumn op instead of splitting them.
 */

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  defaultDefinition: string | null;
  isPrimaryKey: boolean;
}

type AlterTableOp =
  | {
      kind: "addColumn";
      name: string;
      dataType: string;
      nullable: boolean;
      default?: string;
    }
  | { kind: "dropColumn"; name: string }
  | { kind: "renameColumn"; from: string; to: string }
  | {
      kind: "alterColumn";
      name: string;
      dataType: string;
      nullable: boolean;
    };

interface ExistingDraft {
  kind: "existing";
  original: ColumnInfo;
  name: string;
  dataType: string;
  nullable: boolean;
  markedDelete: boolean;
}

interface NewDraft {
  kind: "new";
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpr: string;
}

type Draft = ExistingDraft | NewDraft;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  db: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
  onApplied: () => void;
}

function makeExistingDraft(c: ColumnInfo): ExistingDraft {
  return {
    kind: "existing",
    original: c,
    name: c.name,
    dataType: c.dataType,
    nullable: c.nullable,
    markedDelete: false,
  };
}

function buildOps(drafts: Draft[]): AlterTableOp[] {
  const drops: AlterTableOp[] = [];
  const alters: AlterTableOp[] = [];
  const renames: AlterTableOp[] = [];
  const adds: AlterTableOp[] = [];

  for (const d of drafts) {
    if (d.kind === "existing") {
      const orig = d.original;
      if (d.markedDelete) {
        drops.push({ kind: "dropColumn", name: orig.name });
        continue;
      }
      // ALTER COLUMN is one statement that re-states type + nullability;
      // emit it when either changed.
      if (
        d.dataType.trim() !== orig.dataType.trim() ||
        d.nullable !== orig.nullable
      ) {
        alters.push({
          kind: "alterColumn",
          name: orig.name,
          dataType: d.dataType.trim(),
          nullable: d.nullable,
        });
      }
      if (d.name.trim() !== orig.name) {
        renames.push({
          kind: "renameColumn",
          from: orig.name,
          to: d.name.trim(),
        });
      }
    } else {
      adds.push({
        kind: "addColumn",
        name: d.name.trim(),
        dataType: d.dataType.trim(),
        nullable: d.nullable,
        default: d.defaultExpr.trim() || undefined,
      });
    }
  }

  return [...drops, ...alters, ...renames, ...adds];
}

function formatOpPreview(
  database: string,
  schema: string,
  table: string,
  op: AlterTableOp,
): string {
  const fqn = `[${database}].[${schema}].[${table}]`;
  switch (op.kind) {
    case "addColumn": {
      const parts = [`ALTER TABLE ${fqn} ADD [${op.name}] ${op.dataType}`];
      parts.push(op.nullable ? "NULL" : "NOT NULL");
      if (op.default) parts.push(`DEFAULT (${op.default})`);
      return parts.join(" ");
    }
    case "dropColumn":
      return `ALTER TABLE ${fqn} DROP COLUMN [${op.name}]`;
    case "renameColumn":
      return `EXEC sp_rename N'${schema}.${table}.${op.from}', N'${op.to}', N'COLUMN'`;
    case "alterColumn":
      return `ALTER TABLE ${fqn} ALTER COLUMN [${op.name}] ${op.dataType} ${
        op.nullable ? "NULL" : "NOT NULL"
      }`;
  }
}

export function ModifyTableDialog({
  open,
  onOpenChange,
  connectionId,
  db,
  schema,
  table,
  columns,
  onApplied,
}: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDrafts(columns.map(makeExistingDraft));
  }, [open, columns]);

  const ops = useMemo(() => {
    try {
      return buildOps(drafts);
    } catch {
      return [];
    }
  }, [drafts]);

  type DraftPatch = {
    name?: string;
    dataType?: string;
    nullable?: boolean;
    defaultExpr?: string;
    markedDelete?: boolean;
  };

  const update = (idx: number, patch: DraftPatch) => {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        return { ...d, ...patch } as unknown as Draft;
      }),
    );
  };

  const reset = (idx: number) => {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        if (d.kind === "existing") return makeExistingDraft(d.original);
        return d;
      }),
    );
  };

  const removeDraft = (idx: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const addColumn = () => {
    setDrafts((prev) => [
      ...prev,
      {
        kind: "new",
        id: `new-${Date.now()}-${prev.length}`,
        name: "",
        dataType: "nvarchar(255)",
        nullable: true,
        defaultExpr: "",
      },
    ]);
  };

  const apply = async () => {
    if (ops.length === 0) {
      toast.info("No changes to apply");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not modify table", { description: data.error });
        return;
      }
      toast.success(
        `Applied ${ops.length} change${ops.length === 1 ? "" : "s"}`,
      );
      onApplied();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] max-h-[88vh] overflow-y-auto">
        <DialogBrandStripe tone="rose" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-rose-500/10 text-rose-500"
              aria-hidden
            >
              <Wrench className="size-3" />
            </span>
            Modify <span className="font-mono">{schema}.{table}</span>
          </DialogTitle>
          <DialogDescription>
            Edit columns inline, mark a row to drop, or add a new column.
            Changes batch into a single T-SQL transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 max-h-[55vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0 z-[1]">
              <tr className="font-mono">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-center px-3 py-2 font-medium">Nullable</th>
                <th className="text-left px-3 py-2 font-medium">Default</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, idx) => {
                const dirty =
                  d.kind === "new"
                    ? true
                    : d.markedDelete ||
                      d.name !== d.original.name ||
                      d.dataType !== d.original.dataType ||
                      d.nullable !== d.original.nullable;

                return (
                  <tr
                    key={d.kind === "existing" ? d.original.name : d.id}
                    className={cn(
                      "border-b border-border/40 align-top",
                      d.kind === "existing" && d.markedDelete
                        ? "bg-destructive/5 opacity-60 [&_td]:line-through"
                        : dirty
                          ? "bg-rose-500/5"
                          : "",
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <Input
                        value={d.name}
                        onChange={(e) => update(idx, { name: e.target.value })}
                        spellCheck={false}
                        className="h-7 font-mono text-[12px]"
                        placeholder={d.kind === "new" ? "column_name" : ""}
                        disabled={d.kind === "existing" && d.markedDelete}
                      />
                      {d.kind === "existing" && d.original.isPrimaryKey ? (
                        <span className="ml-1 text-[10px] font-mono uppercase tracking-wider text-rose-500">
                          pk
                        </span>
                      ) : null}
                      {d.kind === "existing" && d.original.isIdentity ? (
                        <span className="ml-1 text-[10px] font-mono uppercase tracking-wider text-amber-500">
                          identity
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={d.dataType}
                        onChange={(e) =>
                          update(idx, { dataType: e.target.value })
                        }
                        spellCheck={false}
                        className="h-7 font-mono text-[12px]"
                        placeholder="nvarchar(255)"
                        disabled={d.kind === "existing" && d.markedDelete}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={d.nullable}
                        onChange={(e) =>
                          update(idx, { nullable: e.target.checked })
                        }
                        disabled={d.kind === "existing" && d.markedDelete}
                        className="size-3.5 accent-rose-500"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {d.kind === "new" ? (
                        <Input
                          value={d.defaultExpr}
                          onChange={(e) =>
                            update(idx, { defaultExpr: e.target.value })
                          }
                          spellCheck={false}
                          className="h-7 font-mono text-[12px]"
                          placeholder="expression…"
                        />
                      ) : (
                        <span className="font-mono text-[12px] text-muted-foreground/80">
                          {d.original.defaultDefinition ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {d.kind === "existing" ? (
                          <>
                            {dirty ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                title="Reset"
                                onClick={() => reset(idx)}
                              >
                                <RotateCcw className="size-3" />
                              </Button>
                            ) : null}
                            <Button
                              size="icon"
                              variant="ghost"
                              className={cn(
                                "size-6 text-destructive hover:text-destructive",
                                d.markedDelete && "bg-destructive/10",
                              )}
                              title={
                                d.markedDelete
                                  ? "Undo drop"
                                  : "Drop column on apply"
                              }
                              onClick={() =>
                                update(idx, { markedDelete: !d.markedDelete })
                              }
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6 text-destructive hover:text-destructive"
                            title="Remove new column"
                            onClick={() => removeDraft(idx)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={5} className="px-2 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addColumn}
                    disabled={submitting}
                  >
                    <Plus className="size-3.5" />
                    Add column
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3 text-rose-500" />
            {ops.length === 0
              ? "no pending changes"
              : `${ops.length} statement${ops.length === 1 ? "" : "s"} on apply`}
          </span>
          {ops.length > 0 ? (
            <details className="cursor-pointer">
              <summary className="hover:text-foreground transition-colors">
                preview T-SQL
              </summary>
              <pre className="mt-2 max-h-[140px] overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-[1.55] whitespace-pre">
                {ops.map((op) => formatOpPreview(db, schema, table, op)).join(";\n")}
                {ops.length ? ";" : ""}
              </pre>
            </details>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={apply}
            disabled={submitting || ops.length === 0}
            className={cn(
              "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
              ctaGlow("rose"),
            )}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Apply{ops.length > 0 ? ` (${ops.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
