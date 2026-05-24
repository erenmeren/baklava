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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TypeCombobox } from "@/components/sql/type-combobox";

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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  onCreated: () => void;
}

export function CreateTypeDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  schema,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [baseType, setBaseType] = useState("nvarchar(255)");
  const [nullable, setNullable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setBaseType("nvarchar(255)");
      setNullable(true);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return setError("Type name is required");
    if (!baseType.trim()) return setError("Base type is required");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/types`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema,
            name: name.trim(),
            baseType: baseType.trim(),
            nullable,
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Type created", {
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create user-defined type</DialogTitle>
          <DialogDescription>
            in <span className="font-mono">{database}.{schema}</span> — alias
            type built on a system base type
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cty-name">Name</Label>
            <Input
              id="cty-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="PostalCode"
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label>Base type</Label>
            <TypeCombobox
              value={baseType}
              onChange={setBaseType}
              options={COMMON_TYPES}
              placeholder="nvarchar(255)"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Built-in T-SQL type the alias is derived from. Length and
              precision are part of the type spec —{" "}
              <span className="font-mono">nvarchar(50)</span>,{" "}
              <span className="font-mono">decimal(10,2)</span>.
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Switch
              id="cty-nullable"
              size="sm"
              checked={nullable}
              onCheckedChange={setNullable}
            />
            <Label
              htmlFor="cty-nullable"
              className="cursor-pointer font-mono text-xs font-normal"
            >
              {nullable ? "NULL" : "NOT NULL"}
              <span className="text-muted-foreground ml-1.5">
                — default nullability for columns of this type
              </span>
            </Label>
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
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
