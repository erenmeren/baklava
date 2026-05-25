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
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Boxes, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { TypeCombobox } from "@/components/sql/type-combobox";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
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
}

function defaultColumns(): ColumnDraft[] {
  return [
    {
      name: "id",
      dataType: "int",
      nullable: false,
      default: "",
      isPrimaryKey: true,
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

export function CreateTableTypeDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  schema,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>(defaultColumns());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setColumns(defaultColumns());
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
      },
    ]);

  const removeColumn = (index: number) =>
    setColumns((prev) => prev.filter((_, i) => i !== index));

  const submit = async () => {
    if (!name.trim()) return setError("Type name is required");
    if (!columns.length) return setError("At least one column is required");
    for (const c of columns) {
      if (!c.name.trim()) return setError("Every column needs a name");
      if (!c.dataType.trim())
        return setError(`Column "${c.name || "(unnamed)"}" needs a data type`);
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/table-types`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema,
            name: name.trim(),
            columns: columns.map((c) => ({
              name: c.name.trim(),
              dataType: c.dataType.trim(),
              nullable: c.nullable,
              default: c.default.trim() || undefined,
              isPrimaryKey: c.isPrimaryKey,
              identity: false, // table types disallow IDENTITY
            })),
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Table type created", {
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
              <Boxes className="size-3" />
            </span>
            Create table type
          </DialogTitle>
          <DialogDescription>
            in{" "}
            <span className="font-mono text-foreground/80">{database}</span>
            <span className="mx-1 text-border" aria-hidden>·</span>
            <span className="font-mono text-foreground/80">{schema}</span>
            <span className="mx-1.5 text-border" aria-hidden>—</span>
            user-defined table type for table-valued parameters
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ctt-name">Type name</Label>
            <Input
              id="ctt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OrderLineTableType"
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Columns</Label>
              <Button size="xs" variant="ghost" onClick={addColumn}>
                <Plus className="size-3" /> Add column
              </Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_52px_1fr_44px_28px] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
                <span>Name</span>
                <span>Type</span>
                <span className="text-center">Null</span>
                <span>Default</span>
                <span className="text-center">PK</span>
                <span></span>
              </div>
              {columns.map((c, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_52px_1fr_44px_28px] gap-2 items-center"
                >
                  <Input
                    value={c.name}
                    onChange={(e) => updateColumn(i, { name: e.target.value })}
                    placeholder="column"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <TypeCombobox
                    value={c.dataType}
                    onChange={(v) => updateColumn(i, { dataType: v })}
                    options={COMMON_TYPES}
                    placeholder="nvarchar(255)"
                  />
                  <label className="flex items-center justify-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={c.nullable}
                      onChange={(e) =>
                        updateColumn(i, { nullable: e.target.checked })
                      }
                    />
                  </label>
                  <Input
                    value={c.default}
                    onChange={(e) =>
                      updateColumn(i, { default: e.target.value })
                    }
                    placeholder="—"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <label className="flex items-center justify-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={c.isPrimaryKey}
                      onChange={(e) =>
                        updateColumn(i, { isPrimaryKey: e.target.checked })
                      }
                    />
                  </label>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => removeColumn(i)}
                    disabled={columns.length === 1}
                    title="Remove column"
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Table types disallow <span className="font-mono">IDENTITY</span>{" "}
              and most constraints; PK and DEFAULT are supported.
            </p>
          </div>

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
            Create table type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
