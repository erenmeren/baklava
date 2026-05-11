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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface ColumnInfo {
  name: string;
  position: number;
  dataType: string;
  isNullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique?: boolean;
  comment?: string | null;
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
  initialRow?: { fields: { name: string }[]; cells: unknown[] };
  onSuccess: () => void;
}

function isJsonType(dt: string) {
  return dt === "jsonb" || dt === "json";
}

function isLongTextType(dt: string) {
  return dt === "text" || isJsonType(dt);
}

function isBoolType(dt: string) {
  return dt === "bool" || dt === "boolean";
}

function cellToText(cell: unknown): string {
  if (cell == null) return "";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

function initialValues(
  columns: ColumnInfo[],
  initialRow: Props["initialRow"]
): Record<string, ColumnValue> {
  const out: Record<string, ColumnValue> = {};
  if (!initialRow) {
    for (const c of columns) {
      out[c.name] = c.default !== null ? { kind: "default" } : { kind: "value", value: "" };
    }
    return out;
  }
  const byName = new Map<string, unknown>();
  initialRow.fields.forEach((f, i) => byName.set(f.name, initialRow.cells[i]));
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
  initialRow: NonNullable<Props["initialRow"]>
): PrimaryKeyValue[] {
  const byName = new Map<string, unknown>();
  initialRow.fields.forEach((f, i) => byName.set(f.name, initialRow.cells[i]));
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "insert" ? "Insert row" : "Edit row"}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">
              {schema}.{table}
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4 py-1">
            {columns.map((c) => {
              const v = values[c.name] ?? { kind: "value" as const, value: "" };
              const allowDefault = mode === "insert" && c.default !== null;
              return (
                <div key={c.name} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono">{c.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.dataType}
                      </span>
                      {c.isPrimaryKey ? (
                        <Badge variant="default" className="font-mono text-[9px] py-0">
                          PK
                        </Badge>
                      ) : null}
                      {!c.isNullable && c.default === null ? (
                        <span className="text-destructive">*</span>
                      ) : null}
                    </Label>
                    <div className="flex items-center gap-1 text-[10px] font-mono">
                      <button
                        type="button"
                        onClick={() => setValue(c.name, { kind: "null" })}
                        className={
                          v.kind === "null"
                            ? "text-foreground underline underline-offset-4"
                            : "text-muted-foreground hover:text-foreground"
                        }
                        disabled={!c.isNullable}
                      >
                        null
                      </button>
                      {allowDefault ? (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <button
                            type="button"
                            onClick={() => setValue(c.name, { kind: "default" })}
                            className={
                              v.kind === "default"
                                ? "text-foreground underline underline-offset-4"
                                : "text-muted-foreground hover:text-foreground"
                            }
                          >
                            default
                          </button>
                        </>
                      ) : null}
                      {v.kind !== "value" ? (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <button
                            type="button"
                            onClick={() =>
                              setValue(c.name, { kind: "value", value: "" })
                            }
                            className="text-muted-foreground hover:text-foreground"
                          >
                            value
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {v.kind === "null" ? (
                    <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs italic text-muted-foreground">
                      NULL
                    </div>
                  ) : v.kind === "default" ? (
                    <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs italic text-muted-foreground font-mono">
                      DEFAULT
                      {c.default ? (
                        <span className="ml-2 not-italic">→ {c.default}</span>
                      ) : null}
                    </div>
                  ) : isBoolType(c.dataType) ? (
                    <div className="flex items-center gap-1 font-mono text-xs">
                      {(["true", "false"] as const).map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setValue(c.name, { kind: "value", value: b })}
                          className={
                            "rounded-md border px-3 py-1.5 " +
                            (v.value === b
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border/60 text-muted-foreground hover:text-foreground")
                          }
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  ) : isLongTextType(c.dataType) ? (
                    <Textarea
                      value={v.value}
                      onChange={(e) =>
                        setValue(c.name, { kind: "value", value: e.target.value })
                      }
                      className="font-mono text-xs"
                      rows={isJsonType(c.dataType) ? 4 : 3}
                      placeholder={isJsonType(c.dataType) ? "{}" : ""}
                    />
                  ) : (
                    <Input
                      value={v.value}
                      onChange={(e) =>
                        setValue(c.name, { kind: "value", value: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mode === "insert" ? "Insert" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
