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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Plus, X, Table as TableIcon, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { TypeCombobox } from "@/components/sql/type-combobox";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
  DialogDivider,
  DialogSection,
  ctaGlow,
} from "@/components/workspace/dialog-shell";

const COMMON_TYPES = [
  "int",
  "bigint",
  "smallint",
  "tinyint",
  "bit",
  "decimal(18,2)",
  "numeric(18,2)",
  "money",
  "float",
  "real",
  "nvarchar(255)",
  "nvarchar(max)",
  "varchar(255)",
  "varchar(max)",
  "char(10)",
  "nchar(10)",
  "date",
  "datetime2",
  "datetimeoffset",
  "time",
  "uniqueidentifier",
  "varbinary(max)",
];

interface ColumnDraft {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string;
  isPrimaryKey: boolean;
  identity: boolean;
}

function defaultColumns(): ColumnDraft[] {
  return [
    {
      name: "id",
      dataType: "int",
      nullable: false,
      default: "",
      isPrimaryKey: true,
      identity: true,
    },
  ];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  onCreated: () => void;
}

export function CreateTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  schema,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>(defaultColumns());
  const [ifNotExists, setIfNotExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setColumns(defaultColumns());
      setIfNotExists(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const updateColumn = (index: number, patch: Partial<ColumnDraft>) =>
    setColumns((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );

  const addColumn = () =>
    setColumns((prev) => [
      ...prev,
      {
        name: "",
        dataType: "nvarchar(255)",
        nullable: true,
        default: "",
        isPrimaryKey: false,
        identity: false,
      },
    ]);

  const removeColumn = (index: number) =>
    setColumns((prev) => prev.filter((_, i) => i !== index));

  const submit = async () => {
    if (!name.trim()) {
      setError("Table name is required");
      return;
    }
    if (!columns.length) {
      setError("At least one column is required");
      return;
    }
    for (const c of columns) {
      if (!c.name.trim()) {
        setError("Every column needs a name");
        return;
      }
      if (!c.dataType.trim()) {
        setError(`Column "${c.name || "(unnamed)"}" needs a data type`);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/tables`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema,
            name: name.trim(),
            ifNotExists,
            columns: columns.map((c) => ({
              name: c.name.trim(),
              dataType: c.dataType.trim(),
              nullable: c.nullable,
              default: c.default.trim() || undefined,
              isPrimaryKey: c.isPrimaryKey,
              identity: c.identity,
            })),
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Table created", {
          description: `${schema}.${name.trim()}`,
        });
        onOpenChange(false);
        onCreated();
      } else {
        setError(data.error || "Create failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pkCount = columns.filter((c) => c.isPrimaryKey).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogBrandStripe tone="rose" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-rose-500/10 text-rose-500"
              aria-hidden
            >
              <TableIcon className="size-3" />
            </span>
            Create table
          </DialogTitle>
          <DialogDescription>
            in{" "}
            <span className="font-mono text-foreground/80">{database}</span>
            <span className="mx-1 text-border" aria-hidden>·</span>
            <span className="font-mono text-foreground/80">{schema}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <DialogSection label="Identity" tone="rose">
            <div className="space-y-1.5">
              <Label
                htmlFor="ct-name"
                className="text-[11px] text-muted-foreground"
              >
                Table name
              </Label>
              <Input
                id="ct-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customers"
                spellCheck={false}
                autoFocus
                className="font-mono"
              />
            </div>
          </DialogSection>

          <DialogDivider />

          <DialogSection
            label="Columns"
            tone="rose"
            hint={
              <span>
                {columns.length}{" "}
                <span className="text-muted-foreground/60">
                  · {pkCount} PK
                </span>
              </span>
            }
          >
            <div className="space-y-1.5">
              <div className="grid grid-cols-[12px_1fr_1fr_42px_42px_1fr_36px_24px] gap-1.5 px-1 text-[9.5px] font-mono uppercase tracking-[0.16em] text-muted-foreground/70">
                <span></span>
                <span>Name</span>
                <span>Type</span>
                <span className="text-center">Null</span>
                <span className="text-center">Ident</span>
                <span>Default</span>
                <span className="text-center">PK</span>
                <span></span>
              </div>
              <div className="space-y-1 rounded-lg border border-border/40 bg-card/40 p-1.5">
                {columns.map((c, i) => (
                  <div
                    key={i}
                    className="group grid grid-cols-[12px_1fr_1fr_42px_42px_1fr_36px_24px] items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:bg-foreground/[0.03]"
                  >
                    <span
                      className="flex h-7 cursor-grab items-center justify-center text-muted-foreground/30 group-hover:text-muted-foreground"
                      title="Drag to reorder (coming soon)"
                      aria-hidden
                    >
                      <GripVertical className="size-3" />
                    </span>
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        updateColumn(i, { name: e.target.value })
                      }
                      placeholder={i === 0 ? "id" : "column"}
                      spellCheck={false}
                      className="h-7 font-mono text-xs"
                    />
                    <TypeCombobox
                      value={c.dataType}
                      onChange={(v) => updateColumn(i, { dataType: v })}
                      options={COMMON_TYPES}
                      placeholder="nvarchar(255)"
                    />
                    <label className="flex h-7 items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.nullable}
                        onChange={(e) =>
                          updateColumn(i, { nullable: e.target.checked })
                        }
                        className="accent-rose-500"
                      />
                    </label>
                    <label className="flex h-7 items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.identity}
                        title="IDENTITY(1,1) — auto-increment"
                        onChange={(e) =>
                          updateColumn(i, { identity: e.target.checked })
                        }
                        className="accent-rose-500"
                      />
                    </label>
                    <Input
                      value={c.default}
                      onChange={(e) =>
                        updateColumn(i, { default: e.target.value })
                      }
                      placeholder="—"
                      spellCheck={false}
                      className="h-7 font-mono text-xs"
                    />
                    <label className="flex h-7 items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.isPrimaryKey}
                        onChange={(e) =>
                          updateColumn(i, { isPrimaryKey: e.target.checked })
                        }
                        className="accent-rose-500"
                      />
                    </label>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeColumn(i)}
                      disabled={columns.length === 1}
                      title="Remove column"
                      className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addColumn}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 px-2 py-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-rose-500/40 hover:bg-rose-500/[0.04] hover:text-rose-500"
                >
                  <Plus className="size-3" />
                  Add column
                </button>
              </div>
              <p className="px-1 text-[10.5px] leading-relaxed text-muted-foreground/80">
                Type and Default accept any T-SQL fragment —{" "}
                <span className="font-mono text-foreground/70">
                  nvarchar(50)
                </span>
                ,{" "}
                <span className="font-mono text-foreground/70">
                  decimal(10,2)
                </span>
                ,{" "}
                <span className="font-mono text-foreground/70">GETDATE()</span>
                ,{" "}
                <span className="font-mono text-foreground/70">NEWID()</span>.
                Multiple PK checkboxes form a composite key;{" "}
                <span className="font-mono text-foreground/70">Ident</span> adds{" "}
                <span className="font-mono text-foreground/70">
                  IDENTITY(1,1)
                </span>
                .
              </p>
            </div>
          </DialogSection>

          <DialogDivider />

          <DialogSection label="Options" tone="rose">
            <label
              htmlFor="ct-if-not-exists"
              className="flex items-center gap-2.5 cursor-pointer rounded-md border border-border/50 bg-card/40 px-3 py-2 transition-colors hover:bg-card/70"
            >
              <Switch
                id="ct-if-not-exists"
                size="sm"
                checked={ifNotExists}
                onCheckedChange={setIfNotExists}
                className="data-checked:bg-rose-500"
              />
              <span className="flex-1">
                <span className="block font-mono text-xs">IF NOT EXISTS</span>
                <span className="block text-[10.5px] text-muted-foreground/80">
                  Skip the CREATE if a table with this name already exists.
                </span>
              </span>
            </label>
          </DialogSection>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not create</AlertTitle>
              <AlertDescription className="break-words font-mono text-xs">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

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
            disabled={busy || !name.trim()}
            className={cn(
              "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
              ctaGlow("rose"),
            )}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
