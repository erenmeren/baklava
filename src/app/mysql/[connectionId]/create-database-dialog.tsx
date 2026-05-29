"use client";

import { useState } from "react";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  onCreated: (databaseName: string) => void;
}

export function CreateDatabaseDialog({
  open,
  onOpenChange,
  connectionId,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [charset, setCharset] = useState("");
  const [collation, setCollation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setCharset("");
    setCollation("");
    setSubmitting(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Database name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/mysql/${connectionId}/databases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          charset: charset.trim() || undefined,
          collation: collation.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not create database", { description: data.error });
        return;
      }
      toast.success(`Database “${trimmed}” created`);
      onCreated(trimmed);
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New database</DialogTitle>
          <DialogDescription>
            Creates a database on the current MySQL server.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="db-name">Name</Label>
            <Input
              id="db-name"
              autoFocus
              placeholder="e.g. analytics_prod"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Letters, numbers, and underscores. Must start with a letter or
              underscore.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="db-charset">Character set</Label>
              <Input
                id="db-charset"
                placeholder="utf8mb4"
                value={charset}
                onChange={(e) => setCharset(e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-collation">Collation</Label>
              <Input
                id="db-collation"
                placeholder="utf8mb4_0900_ai_ci"
                value={collation}
                onChange={(e) => setCollation(e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
