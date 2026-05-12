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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface SequenceFormSeed {
  name: string;
  start: string;
  increment: string;
  minValue: string; // "" means NO MINVALUE
  maxValue: string; // "" means NO MAXVALUE
  cache: string;
  cycle: boolean;
}

const DEFAULT_SEED: SequenceFormSeed = {
  name: "",
  start: "1",
  increment: "1",
  minValue: "",
  maxValue: "",
  cache: "1",
  cycle: false,
};

interface BaseProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  onSuccess: () => void;
}

interface CreateProps extends BaseProps {
  mode: "create";
}

interface EditProps extends BaseProps {
  mode: "edit";
  initial: SequenceFormSeed;
}

type Props = CreateProps | EditProps;

export function SequenceFormDialog(props: Props) {
  const { open, onOpenChange, connectionId, database, schema, onSuccess, mode } =
    props;
  const initial = mode === "edit" ? props.initial : DEFAULT_SEED;

  const [form, setForm] = useState<SequenceFormSeed>(initial);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const update = <K extends keyof SequenceFormSeed>(
    key: K,
    value: SequenceFormSeed[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (mode === "create" && !form.name.trim()) {
      toast.error("Sequence name is required");
      return;
    }
    setSubmitting(true);
    try {
      const options = {
        start: form.start.trim() || undefined,
        increment: form.increment.trim() || undefined,
        minValue: form.minValue.trim() === "" ? null : form.minValue.trim(),
        maxValue: form.maxValue.trim() === "" ? null : form.maxValue.trim(),
        cache: form.cache.trim() || undefined,
        cycle: form.cycle,
      };

      let res: Response;
      if (mode === "create") {
        res = await fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/sequences`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: form.name.trim(), options }),
          },
        );
      } else {
        res = await fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/sequences/${encodeURIComponent(initial.name)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ options }),
          },
        );
      }
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          mode === "create"
            ? "Could not create sequence"
            : "Could not update sequence",
          { description: data.error },
        );
        return;
      }
      toast.success(
        mode === "create"
          ? `Sequence “${form.name.trim()}” created`
          : `Sequence “${initial.name}” updated`,
      );
      onSuccess();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "New sequence"
              : `Edit sequence "${initial.name}"`}
          </DialogTitle>
          <DialogDescription>
            in <span className="font-mono">{database}.{schema}</span>
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          {mode === "create" ? (
            <div className="space-y-1.5">
              <Label htmlFor="seq-name">Name</Label>
              <Input
                id="seq-name"
                autoFocus
                placeholder="e.g. order_id_seq"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="seq-start">Start with</Label>
              <Input
                id="seq-start"
                value={form.start}
                onChange={(e) => update("start", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
                placeholder="1"
              />
              {mode === "edit" ? (
                <p className="text-[10.5px] text-muted-foreground">
                  Use RESTART (re-enter the same value) to reset the counter.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seq-increment">Increment by</Label>
              <Input
                id="seq-increment"
                value={form.increment}
                onChange={(e) => update("increment", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
                placeholder="1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="seq-min">Min value</Label>
              <Input
                id="seq-min"
                value={form.minValue}
                onChange={(e) => update("minValue", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
                placeholder="(none)"
              />
              <p className="text-[10.5px] text-muted-foreground">
                Empty → NO MINVALUE
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seq-max">Max value</Label>
              <Input
                id="seq-max"
                value={form.maxValue}
                onChange={(e) => update("maxValue", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
                placeholder="(none)"
              />
              <p className="text-[10.5px] text-muted-foreground">
                Empty → NO MAXVALUE
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="seq-cache">Cache</Label>
              <Input
                id="seq-cache"
                value={form.cache}
                onChange={(e) => update("cache", e.target.value)}
                disabled={submitting}
                spellCheck={false}
                className="font-mono"
                placeholder="1"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none px-1.5 py-2">
              <input
                type="checkbox"
                checked={form.cycle}
                onChange={(e) => update("cycle", e.target.checked)}
                disabled={submitting}
                className="size-3.5 accent-brand"
              />
              <span className="text-[12.5px]">Cycle on overflow</span>
            </label>
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
              disabled={submitting || (mode === "create" && !form.name.trim())}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
