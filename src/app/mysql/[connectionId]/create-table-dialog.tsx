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
import {
  GripVertical,
  Loader2,
  Plus,
  Table as TableIcon,
  X,
} from "lucide-react";
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
  "INT",
  "BIGINT",
  "VARCHAR(255)",
  "TEXT",
  "DATETIME",
  "TIMESTAMP",
  "DECIMAL(10,2)",
  "BOOLEAN",
  "JSON",
  "DATE",
  "TIME",
  "CHAR(36)",
  "FLOAT",
  "DOUBLE",
  "BLOB",
];

interface ColumnDraft {
  name: string;
  type: string;
  nullable: boolean;
  default: string;
  autoIncrement: boolean;
  primaryKey: boolean;
}

function defaultColumns(): ColumnDraft[] {
  return [
    {
      name: "id",
      type: "BIGINT",
      nullable: false,
      default: "",
      autoIncrement: true,
      primaryKey: true,
    },
  ];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  onCreated: () => void;
}

export function CreateTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>(defaultColumns());
  const [engine, setEngine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setColumns(defaultColumns());
      setEngine("");
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
        type: "VARCHAR(255)",
        nullable: true,
        default: "",
        autoIncrement: false,
        primaryKey: false,
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
      if (!c.type.trim()) {
        setError(`Column "${c.name || "(unnamed)"}" needs a data type`);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/mysql/${connectionId}/databases/${encodeURIComponent(database)}/tables`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            engine: engine.trim() || undefined,
            columns: columns.map((c) => ({
              name: c.name.trim(),
              type: c.type.trim(),
              nullable: c.nullable,
              default: c.default.trim() || undefined,
              autoIncrement: c.autoIncrement,
              primaryKey: c.primaryKey,
            })),
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Table created", {
          description: `${database}.${name.trim()}`,
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

  const pkCount = columns.filter((c) => c.primaryKey).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogBrandStripe tone="sky" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-sky-500/10 text-sky-500"
              aria-hidden
            >
              <TableIcon className="size-3" />
            </span>
            Create table
          </DialogTitle>
          <DialogDescription>
            in{" "}
            <span className="font-mono text-foreground/80">{database}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <DialogSection label="Identity" tone="sky">
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
                placeholder="users"
                spellCheck={false}
                autoFocus
                className="font-mono"
              />
            </div>
          </DialogSection>

          <DialogDivider />

          <DialogSection
            label="Columns"
            tone="sky"
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
              <div className="grid grid-cols-[12px_1fr_1fr_44px_1fr_44px_42px_24px] gap-1.5 px-1 text-[9.5px] font-mono uppercase tracking-[0.16em] text-muted-foreground/70">
                <span></span>
                <span>Name</span>
                <span>Type</span>
                <span className="text-center">Null</span>
                <span>Default</span>
                <span className="text-center">A_I</span>
                <span className="text-center">PK</span>
                <span></span>
              </div>
              <div className="space-y-1 rounded-lg border border-border/40 bg-card/40 p-1.5">
                {columns.map((c, i) => (
                  <div
                    key={i}
                    className="group grid grid-cols-[12px_1fr_1fr_44px_1fr_44px_42px_24px] items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:bg-foreground/[0.03]"
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
                      value={c.type}
                      onChange={(v) => updateColumn(i, { type: v })}
                      options={COMMON_TYPES}
                      placeholder="VARCHAR(255)"
                    />
                    <label className="flex h-7 items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.nullable}
                        onChange={(e) =>
                          updateColumn(i, { nullable: e.target.checked })
                        }
                        className="accent-sky-500"
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
                        checked={c.autoIncrement}
                        onChange={(e) =>
                          updateColumn(i, { autoIncrement: e.target.checked })
                        }
                        className="accent-sky-500"
                      />
                    </label>
                    <label className="flex h-7 items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.primaryKey}
                        onChange={(e) =>
                          updateColumn(i, { primaryKey: e.target.checked })
                        }
                        className="accent-sky-500"
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
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 px-2 py-1.5 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-sky-500/40 hover:bg-sky-500/[0.04] hover:text-sky-500"
                >
                  <Plus className="size-3" />
                  Add column
                </button>
              </div>
              <p className="px-1 text-[10.5px] leading-relaxed text-muted-foreground/80">
                Type and Default accept any SQL fragment —{" "}
                <span className="font-mono text-foreground/70">
                  VARCHAR(50)
                </span>
                ,{" "}
                <span className="font-mono text-foreground/70">
                  DECIMAL(10,2)
                </span>
                ,{" "}
                <span className="font-mono text-foreground/70">
                  CURRENT_TIMESTAMP
                </span>
                . A_I = AUTO_INCREMENT. Multiple PK checkboxes form a composite
                key.
              </p>
            </div>
          </DialogSection>

          <DialogDivider />

          <DialogSection label="Options" tone="sky">
            <div className="space-y-1.5">
              <Label
                htmlFor="ct-engine"
                className="text-[11px] text-muted-foreground"
              >
                Storage engine
              </Label>
              <Input
                id="ct-engine"
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                placeholder="InnoDB (default)"
                spellCheck={false}
                className="font-mono"
              />
            </div>
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
              "bg-sky-600 text-white hover:bg-sky-600/90 focus-visible:ring-sky-500/40",
              ctaGlow("sky"),
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
