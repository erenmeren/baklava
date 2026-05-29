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
import { Loader2, KeyRound, PenLine, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
  ModePill,
  ctaGlow,
} from "@/components/workspace/dialog-shell";

export interface ColumnInfo {
  name: string;
  dataType: string;
  /** Full COLUMN_TYPE, e.g. `varchar(255)`, `int unsigned`. */
  columnType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  extra: string;
  comment: string;
  ordinal: number;
}

export type ColumnValue = string | number | boolean | null;

/** Tri-state cell editor model: explicit null, fall to default, or a value. */
type CellState =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "insert" | "edit";
  base: string;
  db: string;
  table: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  /** The row being edited, keyed by column name. Insert mode leaves this undefined. */
  initialRow?: Record<string, ColumnValue>;
  onSuccess: () => void;
}

function isJsonType(dt: string) {
  return dt === "json";
}

function isLongTextType(dt: string) {
  return (
    dt === "text" ||
    dt === "mediumtext" ||
    dt === "longtext" ||
    dt === "tinytext" ||
    dt === "blob" ||
    isJsonType(dt)
  );
}

function isBoolType(col: ColumnInfo) {
  // MySQL has no real bool — tinyint(1) is the convention.
  return col.columnType === "tinyint(1)";
}

function isNumberType(dt: string) {
  return (
    dt === "int" ||
    dt === "bigint" ||
    dt === "smallint" ||
    dt === "mediumint" ||
    dt === "tinyint" ||
    dt === "decimal" ||
    dt === "float" ||
    dt === "double"
  );
}

function isAutoIncrement(col: ColumnInfo) {
  return /auto_increment/i.test(col.extra);
}

function cellToText(cell: ColumnValue): string {
  if (cell == null) return "";
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function initialValues(
  columns: ColumnInfo[],
  initialRow: Props["initialRow"]
): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  if (!initialRow) {
    for (const c of columns) {
      out[c.name] =
        c.default !== null || isAutoIncrement(c)
          ? { kind: "default" }
          : { kind: "value", value: "" };
    }
    return out;
  }
  for (const c of columns) {
    const v = initialRow[c.name];
    if (v === null || v === undefined) {
      out[c.name] = { kind: "null" };
    } else if (typeof v === "boolean") {
      out[c.name] = { kind: "value", value: v ? "1" : "0" };
    } else {
      out[c.name] = { kind: "value", value: cellToText(v) };
    }
  }
  return out;
}

/** Convert a tri-state cell back into the JSON payload value for the API. */
function toPayload(col: ColumnInfo, state: CellState): ColumnValue {
  if (state.kind === "null") return null;
  // "default" cells are omitted by the caller (not included in the payload).
  if (state.kind === "default") return null;
  const raw = state.value;
  if (isBoolType(col)) return raw === "1" || raw === "true" ? 1 : 0;
  if (isNumberType(col.dataType)) {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

export function RowFormDialog({
  open,
  onOpenChange,
  mode,
  base,
  db,
  table,
  columns,
  primaryKey,
  initialRow,
  onSuccess,
}: Props) {
  const [values, setValues] = useState<Record<string, CellState>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValues(initialValues(columns, initialRow));
  }, [open, columns, initialRow]);

  const setValue = (col: string, v: CellState) =>
    setValues((prev) => ({ ...prev, [col]: v }));

  const buildValues = (): Record<string, ColumnValue> => {
    const payload: Record<string, ColumnValue> = {};
    for (const c of columns) {
      const state = values[c.name] ?? { kind: "value" as const, value: "" };
      // Skip "default" cells so the server applies the column default.
      if (state.kind === "default") continue;
      payload[c.name] = toPayload(c, state);
    }
    return payload;
  };

  const submit = async () => {
    setBusy(true);
    try {
      let res: Response;
      if (mode === "insert") {
        res = await fetch(`${base}/rows`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: buildValues() }),
        });
      } else {
        if (!initialRow) throw new Error("Missing original row");
        if (primaryKey.length === 0) {
          toast.error("Cannot edit row", {
            description: "This table has no primary key.",
          });
          setBusy(false);
          return;
        }
        const pk = Object.fromEntries(
          primaryKey.map((c) => [c, initialRow[c] ?? null])
        );
        res = await fetch(`${base}/rows`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pk, values: buildValues() }),
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
        <DialogBrandStripe tone="indigo" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-500"
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
              {db}.{table}
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62vh] -mx-2 pl-2 pr-3">
          <div className="space-y-2 py-1">
            {columns.map((c) => {
              const v = values[c.name] ?? { kind: "value" as const, value: "" };
              const autoInc = isAutoIncrement(c);
              const allowDefault =
                isInsert && (c.default !== null || autoInc);
              const required = !c.nullable && c.default === null && !autoInc;
              return (
                <div
                  key={c.name}
                  className={cn(
                    "group relative rounded-lg border border-border/50 bg-card/40 px-3 py-2 transition-colors hover:border-border/80 focus-within:border-indigo-500/40",
                    c.isPrimaryKey && "border-indigo-500/30 bg-indigo-500/[0.03]"
                  )}
                >
                  {c.isPrimaryKey ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-gradient-to-b from-indigo-500/0 via-indigo-500/70 to-indigo-500/0"
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-[12.5px]">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-[10px] font-mono text-muted-foreground/80">
                        {c.columnType}
                      </span>
                      {c.isPrimaryKey ? (
                        <Badge
                          variant="outline"
                          className="border-indigo-500/40 bg-indigo-500/10 text-[9px] font-mono uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400 py-0"
                        >
                          <KeyRound className="size-2.5" /> PK
                        </Badge>
                      ) : null}
                      {autoInc ? (
                        <span className="shrink-0 text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70">
                          auto_increment
                        </span>
                      ) : null}
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
                        disabled={!c.nullable}
                        tone="indigo"
                        tabIndex={-1}
                      >
                        null
                      </ModePill>
                      {allowDefault ? (
                        <ModePill
                          active={v.kind === "default"}
                          onClick={() => setValue(c.name, { kind: "default" })}
                          tone="indigo"
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
                        tone="indigo"
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
                      <div className="rounded-md border border-dashed border-indigo-500/30 bg-indigo-500/[0.04] px-3 py-2 text-[11.5px] font-mono text-indigo-600 dark:text-indigo-400">
                        <span className="uppercase tracking-[0.16em]">
                          {autoInc ? "auto_increment" : "default"}
                        </span>
                        {c.default ? (
                          <span className="ml-2 text-foreground/70">
                            → {c.default}
                          </span>
                        ) : null}
                      </div>
                    ) : isBoolType(c) ? (
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        {(
                          [
                            ["1", "true"],
                            ["0", "false"],
                          ] as const
                        ).map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            tabIndex={-1}
                            onClick={() =>
                              setValue(c.name, { kind: "value", value: val })
                            }
                            className={cn(
                              "rounded-md border px-3 py-1.5 transition-colors",
                              v.value === val
                                ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                            )}
                          >
                            {label}
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
                        rows={isJsonType(c.dataType) ? 4 : 3}
                        placeholder={isJsonType(c.dataType) ? "{ }" : ""}
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
            className={cn(
              "bg-indigo-600 text-white hover:bg-indigo-600/90 focus-visible:ring-indigo-500/40",
              ctaGlow("indigo")
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
