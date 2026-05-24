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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  onCreated: () => void;
}

export function CreateSynonymDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  schema,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setTarget("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return setError("Synonym name is required");
    if (!target.trim()) return setError("Target object is required");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/synonyms`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schema, name: name.trim(), target: target.trim() }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Synonym created", {
          description: `${schema}.${name.trim()} → ${target.trim()}`,
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
          <DialogTitle>Create synonym</DialogTitle>
          <DialogDescription>
            in <span className="font-mono">{database}.{schema}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csy-name">Name</Label>
            <Input
              id="csy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Orders"
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="csy-target">Target object</Label>
            <Input
              id="csy-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="[OtherDb].[sales].[Orders]"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              A 1- to 4-part reference: <span className="font-mono">name</span>,{" "}
              <span className="font-mono">schema.name</span>,{" "}
              <span className="font-mono">db.schema.name</span>, or{" "}
              <span className="font-mono">server.db.schema.name</span>. Use
              brackets for identifiers with special characters.
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
            disabled={busy || !name.trim() || !target.trim()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
