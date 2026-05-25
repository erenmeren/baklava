"use client";

import { useEffect, useState } from "react";
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
import { Loader2, KeyRound, PenLine, Plus, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
  ModePill,
  ctaGlow,
} from "@/components/workspace/dialog-shell";

/**
 * SQL Server flavor of the row form. Same shape as the Postgres one
 * (row-form-dialog.tsx under postgres/...) but tinted rose, with
 * SQL-Server-specific type detection (bit / nvarchar(max) / etc.) and
 * IDENTITY columns automatically locked out of the insert form.
 */

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  defaultDefinition: string | null;
  isPrimaryKey: boolean;
}

export type ColumnValue =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

interface PrimaryKeyValue {
  column: string;
  value: unknown;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "insert" | "edit";
  base: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
  initialRow?: { fields: string[]; cells: unknown[] };
  onSuccess: () => void;
}

function isLongTextType(dt: string) {
  const t = dt.toLowerCase();
  return (
    /^(n?text)$/.test(t) ||
    /^x?ml$/.test(t) ||
    t.includes("(max)")
  );
}

function isBitType(dt: string) {
  return dt.toLowerCase() === "bit";
}

function cellToText(cell: unknown): string {
  if (cell == null) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function initialValues(
  columns: ColumnInfo[],
  initialRow: Props["initialRow"],
): Record<string, ColumnValue> {
  const out: Record<string, ColumnValue> = {};
  if (!initialRow) {
    for (const c of columns) {
      // IDENTITY columns aren't settable on insert; defaults pick up the
      // sequence. Same for any column with a server default.
      if (c.isIdentity || c.defaultDefinition !== null) {
        out[c.name] = { kind: "default" };
      } else {
        out[c.name] = { kind: "value", value: "" };
      }
    }
    return out;
  }
  const byName = new Map<string, unknown>();
  initialRow.fields.forEach((f, i) => byName.set(f, initialRow.cells[i]));
  for (const c of columns) {
    const v = byName.get(c.name);
    if (v === null || v === undefined) {
      out[c.name] = { kind: "null" };
    } else {
      out[c.name] = { kind: "value", value: cellToText(v) };
    }
  }
  return out;
}

function originalPk(
  columns: ColumnInfo[],
  initialRow: NonNullable<Props["initialRow"]>,
): PrimaryKeyValue[] {
  const byName = new Map<string, unknown>();
  initialRow.fields.forEach((f, i) => byName.set(f, initialRow.cells[i]));
  return columns
    .filter((c) => c.isPrimaryKey)
    .map((c) => ({ column: c.name, value: byName.get(c.name) ?? null }));
}

export function RowFormDialog({
  open,
  onOpenChange,
  mode,
  base,
  schema,
  table,
  columns,
  initialRow,
  onSuccess,
}: Props) {
  const [values, setValues] = useState<Record<string, ColumnValue>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValues(initialValues(columns, initialRow));
  }, [open, columns, initialRow]);

  const setValue = (col: string, v: ColumnValue) =>
    setValues((prev) => ({ ...prev, [col]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      let res: Response;
      if (mode === "insert") {
        res = await fetch(`${base}/rows`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values }),
        });
      } else {
        if (!initialRow) throw new Error("Missing original row");
        const pk = originalPk(columns, initialRow);
        if (pk.length === 0) {
          toast.error("Cannot edit row", {
            description: "This table has no primary key.",
          });
          setBusy(false);
          return;
        }
        res = await fetch(`${base}/rows`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pk, values }),
        });
      }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogBrandStripe tone="rose" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-rose-500/10 text-rose-500"
              aria-hidden
            >
              {isInsert ? (
                <Plus className="size-3" />
              ) : (
                <PenLine className="size-3" />
              )}
            </span>
            {isInsert ? "Insert row" : "Edit row"}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground/80">
              {schema}.{table}
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62vh] -mx-2 pl-2 pr-3">
          <div className="space-y-2 py-1">
            {columns.map((c) => {
              const v = values[c.name] ?? { kind: "value" as const, value: "" };
              // IDENTITY can't be overridden on insert; server-default columns
              // get a "default" affordance, but editing them on UPDATE is fine.
              const allowDefault =
                isInsert &&
                (c.isIdentity || c.defaultDefinition !== null);
              const identityLocked = isInsert && c.isIdentity;
              const required =
                !c.nullable && c.defaultDefinition === null && !c.isIdentity;
              return (
                <div
                  key={c.name}
                  className={cn(
                    "group relative rounded-lg border border-border/50 bg-card/40 px-3 py-2 transition-colors hover:border-border/80 focus-within:border-rose-500/40",
                    c.isPrimaryKey && "border-rose-500/30 bg-rose-500/[0.03]",
                  )}
                >
                  {c.isPrimaryKey ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-gradient-to-b from-rose-500/0 via-rose-500/70 to-rose-500/0"
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
                          className="border-rose-500/40 bg-rose-500/10 text-[9px] font-mono uppercase tracking-[0.14em] text-rose-600 dark:text-rose-400 py-0"
                        >
                          <KeyRound className="size-2.5" /> PK
                        </Badge>
                      ) : null}
                      {c.isIdentity ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-[9px] font-mono uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400 py-0"
                        >
                          <Zap className="size-2.5" /> IDENTITY
                        </Badge>
                      ) : null}
                      {required ? (
                        <span
                          className="leading-none text-rose-500"
                          title="Required (not null, no default)"
                        >
                          *
                        </span>
                      ) : null}
                    </Label>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <ModePill
                        active={v.kind === "null"}
                        onClick={() => setValue(c.name, { kind: "null" })}
                        disabled={!c.nullable || identityLocked}
                        tone="rose"
                      >
                        null
                      </ModePill>
                      {allowDefault ? (
                        <ModePill
                          active={v.kind === "default"}
                          onClick={() => setValue(c.name, { kind: "default" })}
                          tone="rose"
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
                        disabled={identityLocked}
                        tone="rose"
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
                      <div className="rounded-md border border-dashed border-rose-500/30 bg-rose-500/[0.04] px-3 py-2 text-[11.5px] font-mono text-rose-600 dark:text-rose-400">
                        <span className="uppercase tracking-[0.16em]">
                          {c.isIdentity ? "identity" : "default"}
                        </span>
                        {c.defaultDefinition ? (
                          <span className="ml-2 text-foreground/70">
                            → {c.defaultDefinition}
                          </span>
                        ) : null}
                      </div>
                    ) : isBitType(c.dataType) ? (
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        {(["1", "0"] as const).map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() =>
                              setValue(c.name, { kind: "value", value: b })
                            }
                            className={cn(
                              "rounded-md border px-3 py-1.5 transition-colors",
                              v.value === b
                                ? "border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                            )}
                          >
                            {b === "1" ? "1 · true" : "0 · false"}
                          </button>
                        ))}
                      </div>
                    ) : isLongTextType(c.dataType) ? (
                      <Textarea
                        value={v.value}
                        onChange={(e) =>
                          setValue(c.name, {
                            kind: "value",
                            value: e.target.value,
                          })
                        }
                        className="font-mono text-xs"
                        rows={3}
                      />
                    ) : (
                      <Input
                        value={v.value}
                        onChange={(e) =>
                          setValue(c.name, {
                            kind: "value",
                            value: e.target.value,
                          })
                        }
                        className="h-8 font-mono text-xs"
                        placeholder={c.defaultDefinition ?? ""}
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
            className={cn(
              "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
              ctaGlow("rose"),
            )}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isInsert ? "Insert row" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
