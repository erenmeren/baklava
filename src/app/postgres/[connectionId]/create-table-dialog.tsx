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
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

const COMMON_TYPES = [
  "text",
  "varchar(255)",
  "int4",
  "int8",
  "int2",
  "serial",
  "bigserial",
  "bool",
  "uuid",
  "timestamp",
  "timestamptz",
  "date",
  "jsonb",
  "json",
  "numeric",
  "float8",
  "float4",
  "bytea",
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
      dataType: "bigserial",
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
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );

  const addColumn = () =>
    setColumns((prev) => [
      ...prev,
      {
        name: "",
        dataType: "text",
        nullable: true,
        default: "",
        isPrimaryKey: false,
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
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/tables`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            ifNotExists,
            columns: columns.map((c) => ({
              name: c.name.trim(),
              dataType: c.dataType.trim(),
              nullable: c.nullable,
              default: c.default.trim() || undefined,
              isPrimaryKey: c.isPrimaryKey,
            })),
          }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Table created`, {
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
        <DialogHeader>
          <DialogTitle>Create table</DialogTitle>
          <DialogDescription>
            in{" "}
            <span className="font-mono">
              {database}.{schema}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ct-name">Table name</Label>
            <Input
              id="ct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="users"
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
              <div className="grid grid-cols-[1fr_1fr_64px_1fr_44px_28px] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
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
                  className="grid grid-cols-[1fr_1fr_64px_1fr_44px_28px] gap-2 items-center"
                >
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      updateColumn(i, { name: e.target.value })
                    }
                    placeholder="column"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <Input
                    list={`ct-types-${i}`}
                    value={c.dataType}
                    onChange={(e) =>
                      updateColumn(i, { dataType: e.target.value })
                    }
                    placeholder="text"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <datalist id={`ct-types-${i}`}>
                    {COMMON_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
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
              Type and Default are SQL expressions —{" "}
              <span className="font-mono">varchar(50)</span>,{" "}
              <span className="font-mono">numeric(10,2)</span>,{" "}
              <span className="font-mono">now()</span>,{" "}
              <span className="font-mono">gen_random_uuid()</span>. Multiple PK
              checkboxes form a composite primary key.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ifNotExists}
              onChange={(e) => setIfNotExists(e.target.checked)}
            />
            <span className="font-mono text-xs">IF NOT EXISTS</span>
          </label>

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
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
