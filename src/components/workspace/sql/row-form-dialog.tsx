"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, KeyRound, PenLine, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
  ModePill,
  ctaGlow,
  type DialogTone,
} from "@/components/workspace/dialog-shell";
import type { SqlColumn } from "./types";

export type CellState =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

export interface RowFormDialect {
  tint: "brand" | "rose";
  /** Column is not settable on insert (IDENTITY / auto_increment / server default). */
  lockedOnInsert: (column: SqlColumn) => boolean;
  isLongText: (dataType: string) => boolean;
  isBoolean: (dataType: string) => boolean;
  /**
   * Stronger lock than `lockedOnInsert`: also disables the null/value toggle
   * pills on insert, not just the initial state (SQL Server IDENTITY columns
   * can't be overridden at all; plain server-default columns still can be).
   * Defaults to never hard-locking.
   */
  hardLockedOnInsert?: (column: SqlColumn) => boolean;
  /**
   * Extra JSON affordance on the long-text textarea (4 rows + a `{ }`
   * placeholder instead of 3 rows / no placeholder). Postgres and MySQL both
   * special-case their `json`/`jsonb` type this way; SQL Server has no
   * native JSON type and never sets this.
   */
  isJsonText?: (dataType: string) => boolean;
  /** The value/label pairs offered for a boolean column. Defaults to true/false text. */
  booleanOptions?: Array<{ value: string; label: string }>;
  /** Label shown inside the locked "default" cell box. Defaults to "default". */
  defaultCellLabel?: (column: SqlColumn) => string;
  /** Extra badge/chip rendered in the column header next to the PK badge. */
  columnBadge?: (column: SqlColumn) => ReactNode;
  /** Turn the edited cell map into this tech's request body. */
  toBody: (args: {
    mode: "insert" | "edit";
    values: Record<string, CellState>;
    columns: SqlColumn[];
    initialRow: Record<string, unknown> | undefined;
  }) => unknown;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "insert" | "edit";
  /** API base URL; the dialog POSTs/PATCHes `${base}/rows`. */
  base: string;
  title: string;
  /** Secondary line under the title — typically the schema/db + table namespace. */
  description?: ReactNode;
  columns: SqlColumn[];
  /** The row being edited, keyed by column name. Undefined on insert. */
  initialRow?: Record<string, unknown>;
  dialect: RowFormDialect;
  onSuccess: () => void;
}

const TINT: Record<
  "brand" | "rose",
  {
    tone: DialogTone;
    iconWrap: string;
    focusWithin: string;
    pkRow: string;
    pkStripe: string;
    pkBadge: string;
    boolActive: string;
    defaultBox: string;
    submitBtn: string;
  }
> = {
  brand: {
    tone: "indigo",
    iconWrap: "bg-indigo-500/10 text-indigo-500",
    focusWithin: "focus-within:border-indigo-500/40",
    pkRow: "border-indigo-500/30 bg-indigo-500/[0.03]",
    pkStripe: "from-indigo-500/0 via-indigo-500/70 to-indigo-500/0",
    pkBadge:
      "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    boolActive:
      "border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    defaultBox:
      "border-indigo-500/30 bg-indigo-500/[0.04] text-indigo-600 dark:text-indigo-400",
    submitBtn:
      "bg-indigo-600 text-white hover:bg-indigo-600/90 focus-visible:ring-indigo-500/40",
  },
  rose: {
    tone: "rose",
    iconWrap: "bg-rose-500/10 text-rose-500",
    focusWithin: "focus-within:border-rose-500/40",
    pkRow: "border-rose-500/30 bg-rose-500/[0.03]",
    pkStripe: "from-rose-500/0 via-rose-500/70 to-rose-500/0",
    pkBadge:
      "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    boolActive:
      "border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    defaultBox:
      "border-rose-500/30 bg-rose-500/[0.04] text-rose-600 dark:text-rose-400",
    submitBtn:
      "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
  },
};

const DEFAULT_BOOLEAN_OPTIONS = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

function cellToText(cell: unknown): string {
  if (cell == null) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function initialValues(
  columns: SqlColumn[],
  initialRow: Props["initialRow"],
  dialect: RowFormDialect,
): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  if (!initialRow) {
    for (const c of columns) {
      out[c.name] = dialect.lockedOnInsert(c)
        ? { kind: "default" }
        : { kind: "value", value: "" };
    }
    return out;
  }
  for (const c of columns) {
    const v = initialRow[c.name];
    if (v === null || v === undefined) {
      out[c.name] = { kind: "null" };
    } else {
      out[c.name] = { kind: "value", value: cellToText(v) };
    }
  }
  return out;
}

export function RowFormDialog({
  open,
  onOpenChange,
  mode,
  base,
  title,
  description,
  columns,
  initialRow,
  dialect,
  onSuccess,
}: Props) {
  const [values, setValues] = useState<Record<string, CellState>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValues(initialValues(columns, initialRow, dialect));
    // dialect is expected to be a stable per-tech constant, not re-created
    // per render, so it's intentionally left out of the dependency array —
    // see the three call sites, which build it once at module scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, columns, initialRow]);

  const setValue = (col: string, v: CellState) =>
    setValues((prev) => ({ ...prev, [col]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const body = dialect.toBody({ mode, values, columns, initialRow });
      const res = await fetch(`${base}/rows`, {
        method: mode === "insert" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(mode === "insert" ? "Row inserted" : "Row updated");
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(mode === "insert" ? "Insert failed" : "Update failed", {
          description: data.error,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const isInsert = mode === "insert";
  const t = TINT[dialect.tint];
  const booleanOptions = dialect.booleanOptions ?? DEFAULT_BOOLEAN_OPTIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogBrandStripe tone={t.tone} />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-md",
                t.iconWrap,
              )}
              aria-hidden
            >
              {isInsert ? (
                <Plus className="size-3" />
              ) : (
                <PenLine className="size-3" />
              )}
            </span>
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <ScrollArea className="max-h-[62vh] -mx-2 pl-2 pr-3">
          <div className="space-y-2 py-1">
            {columns.map((c) => {
              const v = values[c.name] ?? { kind: "value" as const, value: "" };
              const allowDefault = isInsert && dialect.lockedOnInsert(c);
              const hardLocked =
                isInsert && (dialect.hardLockedOnInsert?.(c) ?? false);
              const required =
                !c.nullable && c.default === null && !dialect.lockedOnInsert(c);
              const isJson = dialect.isJsonText?.(c.dataType) ?? false;
              return (
                <div
                  key={c.name}
                  data-row={c.name}
                  className={cn(
                    "group relative rounded-lg border border-border/50 bg-card/40 px-3 py-2 transition-colors hover:border-border/80",
                    t.focusWithin,
                    c.isPrimaryKey && t.pkRow,
                  )}
                >
                  {c.isPrimaryKey ? (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-gradient-to-b",
                        t.pkStripe,
                      )}
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-[12.5px]">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-[10px] font-mono text-muted-foreground/80">
                        {c.dataType}
                      </span>
                      {c.isPrimaryKey ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] font-mono uppercase tracking-[0.14em] py-0",
                            t.pkBadge,
                          )}
                        >
                          <KeyRound className="size-2.5" /> PK
                        </Badge>
                      ) : null}
                      {dialect.columnBadge?.(c) ?? null}
                      {required ? (
                        <span
                          className="text-rose-500 leading-none"
                          title="Required (not null, no default)"
                        >
                          *
                        </span>
                      ) : null}
                    </Label>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <ModePill
                        active={v.kind === "null"}
                        onClick={() => setValue(c.name, { kind: "null" })}
                        disabled={!c.nullable || hardLocked}
                        tone={t.tone}
                        tabIndex={-1}
                        aria-label={`Set ${c.name} to null`}
                      >
                        null
                      </ModePill>
                      {allowDefault ? (
                        <ModePill
                          active={v.kind === "default"}
                          onClick={() => setValue(c.name, { kind: "default" })}
                          tone={t.tone}
                          tabIndex={-1}
                        >
                          default
                        </ModePill>
                      ) : null}
                      <ModePill
                        active={v.kind === "value"}
                        onClick={() =>
                          setValue(c.name, {
                            kind: "value",
                            value: v.kind === "value" ? v.value : "",
                          })
                        }
                        disabled={hardLocked}
                        tone={t.tone}
                        tabIndex={-1}
                      >
                        value
                      </ModePill>
                    </div>
                  </div>

                  <div className="mt-1.5">
                    {v.kind === "null" ? (
                      <div className="rounded-md border border-dashed border-border/50 bg-background/40 px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
                        NULL
                      </div>
                    ) : v.kind === "default" ? (
                      <div
                        className={cn(
                          "rounded-md border border-dashed px-3 py-2 text-[11.5px] font-mono",
                          t.defaultBox,
                        )}
                      >
                        <span className="uppercase tracking-[0.16em]">
                          {dialect.defaultCellLabel?.(c) ?? "default"}
                        </span>
                        {c.default ? (
                          <span className="ml-2 text-foreground/70">
                            → {c.default}
                          </span>
                        ) : null}
                      </div>
                    ) : dialect.isBoolean(c.dataType) ? (
                      <div
                        className="flex items-center gap-1.5 font-mono text-xs"
                        aria-label={c.name}
                      >
                        {booleanOptions.map((b) => (
                          <button
                            key={b.value}
                            type="button"
                            tabIndex={-1}
                            onClick={() =>
                              setValue(c.name, { kind: "value", value: b.value })
                            }
                            className={cn(
                              "rounded-md border px-3 py-1.5 transition-colors",
                              v.value === b.value
                                ? t.boolActive
                                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                            )}
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    ) : dialect.isLongText(c.dataType) ? (
                      <Textarea
                        aria-label={c.name}
                        value={v.value}
                        onChange={(e) =>
                          setValue(c.name, {
                            kind: "value",
                            value: e.target.value,
                          })
                        }
                        className="font-mono text-xs"
                        rows={isJson ? 4 : 3}
                        placeholder={isJson ? "{ }" : ""}
                      />
                    ) : (
                      <Input
                        aria-label={c.name}
                        value={v.value}
                        onChange={(e) =>
                          setValue(c.name, {
                            kind: "value",
                            value: e.target.value,
                          })
                        }
                        className="h-8 font-mono text-xs"
                        placeholder={c.default ?? ""}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy}
            className={cn(t.submitBtn, ctaGlow(t.tone))}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isInsert ? "Insert row" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
