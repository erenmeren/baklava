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
import { Loader2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  db: string;
  table: string;
  /** Column names in the table — used to build the chip picker. */
  availableColumns: string[];
  onCreated: () => void;
}

export function CreateIndexDialog({
  open,
  onOpenChange,
  connectionId,
  db,
  table,
  availableColumns,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setUnique(false);
      setColumns([]);
    }
  }, [open]);

  const toggleCol = (c: string) => {
    setColumns((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const moveCol = (c: string, dir: -1 | 1) => {
    setColumns((prev) => {
      const idx = prev.indexOf(c);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Index name is required");
      return;
    }
    if (columns.length === 0) {
      toast.error("Pick at least one column");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/mysql/${connectionId}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/indexes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            columns,
            unique,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not create index", { description: data.error });
        return;
      }
      toast.success("Index created");
      onCreated();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>New index</DialogTitle>
          <DialogDescription>
            on{" "}
            <span className="font-mono">
              {db}.{table}
            </span>
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
            <Label htmlFor="idx-name">Name</Label>
            <Input
              id="idx-name"
              placeholder={`${table}_idx`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              spellCheck={false}
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Columns</Label>
            <div className="rounded-md border border-border/60 p-2 flex flex-wrap gap-1.5">
              {availableColumns.length === 0 ? (
                <span className="text-[11.5px] text-muted-foreground">
                  No columns available.
                </span>
              ) : (
                availableColumns.map((c) => {
                  const selectedIdx = columns.indexOf(c);
                  const selected = selectedIdx >= 0;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCol(c)}
                      disabled={submitting}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded border text-[11.5px] font-mono transition-colors",
                        selected
                          ? "bg-brand/15 text-brand border-brand/40"
                          : "bg-foreground/5 text-foreground/80 border-border hover:bg-foreground/10"
                      )}
                    >
                      {selected ? (
                        <span className="text-[10px] tabular-nums opacity-80">
                          {selectedIdx + 1}
                        </span>
                      ) : (
                        <Plus className="size-3 opacity-60" />
                      )}
                      <span>{c}</span>
                    </button>
                  );
                })
              )}
            </div>
            {columns.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">order:</span>
                {columns.map((c, i) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-foreground/5 border border-border font-mono text-[11px]"
                  >
                    <button
                      type="button"
                      onClick={() => moveCol(c, -1)}
                      disabled={i === 0 || submitting}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="Move left"
                    >
                      ‹
                    </button>
                    {c}
                    <button
                      type="button"
                      onClick={() => moveCol(c, 1)}
                      disabled={i === columns.length - 1 || submitting}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="Move right"
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCol(c)}
                      disabled={submitting}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="idx-unique"
              size="sm"
              checked={unique}
              onCheckedChange={setUnique}
              disabled={submitting}
            />
            <Label
              htmlFor="idx-unique"
              className="cursor-pointer text-[12.5px] font-normal"
            >
              Unique
            </Label>
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
            <Button
              type="submit"
              disabled={submitting || columns.length === 0 || !name.trim()}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
