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
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DialogBrandStripe,
  ctaGlow,
} from "@/components/workspace/dialog-shell";

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
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
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
      const res = await fetch(`/api/sqlserver/${connectionId}/databases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
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
      <DialogContent className="sm:max-w-[460px]">
        <DialogBrandStripe tone="rose" />
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md bg-rose-500/10 text-rose-500"
              aria-hidden
            >
              <Database className="size-3" />
            </span>
            New database
          </DialogTitle>
          <DialogDescription>
            Creates a database on the current SQL Server instance with server
            defaults.
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
              placeholder="e.g. Analytics"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Letters, digits, and underscores only.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !name.trim()}
              className={cn(
                "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
                ctaGlow("rose"),
              )}
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Create database
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
