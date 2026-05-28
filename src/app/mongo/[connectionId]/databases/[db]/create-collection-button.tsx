"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  connectionId: string;
  dbName: string;
}

export function CreateCollectionButton({ connectionId, dbName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [capped, setCapped] = useState(false);
  const [size, setSize] = useState("");
  const [max, setMax] = useState("");
  const [validator, setValidator] = useState("");
  const [validationLevel, setValidationLevel] = useState<
    "off" | "strict" | "moderate"
  >("strict");
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (capped) {
        body.capped = true;
        if (size) body.size = Number(size);
        if (max) body.max = Number(max);
      }
      if (validator.trim()) {
        body.validatorEjson = validator.trim();
        body.validationLevel = validationLevel;
      }
      const res = await fetch(
        `/api/mongo/${connectionId}/databases/${encodeURIComponent(dbName)}/collections`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Collection "${name}" created`);
      setOpen(false);
      setName("");
      router.refresh();
    } catch (err) {
      toast.error("Create failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  let validValidator = true;
  if (validator.trim()) {
    try {
      JSON.parse(validator);
    } catch {
      validValidator = false;
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Create collection
      </Button>
      {open ? (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-background/55 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-4 top-20 max-w-xl mx-auto bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30">
              <h2 className="font-semibold text-sm">
                Create collection in <span className="font-mono">{dbName}</span>
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
              <div className="space-y-1">
                <Label htmlFor="cc-name">Name</Label>
                <Input
                  id="cc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="font-mono"
                  autoFocus
                />
              </div>
              <div className="rounded border border-border/60 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="cc-capped" className="text-sm">
                      Capped collection
                    </Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Fixed-size, FIFO eviction. Useful for logs / rolling buffers.
                    </p>
                  </div>
                  <Switch
                    id="cc-capped"
                    checked={capped}
                    onCheckedChange={setCapped}
                  />
                </div>
                {capped ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="cc-size">Max size (bytes)</Label>
                      <Input
                        id="cc-size"
                        type="number"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        placeholder="1048576"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cc-max">Max documents (optional)</Label>
                      <Input
                        id="cc-max"
                        type="number"
                        value={max}
                        onChange={(e) => setMax(e.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded border border-border/60 p-3 space-y-3">
                <Label htmlFor="cc-validator" className="text-sm">
                  JSON Schema validator (optional)
                </Label>
                <Input
                  id="cc-validator"
                  value={validator}
                  onChange={(e) => setValidator(e.target.value)}
                  className="font-mono"
                  placeholder='{"$jsonSchema": {"required": ["email"]}}'
                />
                {!validValidator ? (
                  <p className="text-[11px] text-red-500">JSON syntax error</p>
                ) : null}
                {validator.trim() ? (
                  <div className="grid grid-cols-3 gap-1">
                    {(["off", "moderate", "strict"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setValidationLevel(lvl)}
                        className={
                          validationLevel === lvl
                            ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs py-1 rounded"
                            : "border border-border/60 text-muted-foreground text-xs py-1 rounded hover:bg-foreground/5"
                        }
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/30">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={create}
                disabled={!name.trim() || !validValidator || saving}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Create
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
