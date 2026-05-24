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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const TYPES = [
  "bigint",
  "int",
  "smallint",
  "tinyint",
  "decimal(18,0)",
  "numeric(18,0)",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  database: string;
  schema: string;
  onCreated: () => void;
}

export function CreateSequenceDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  schema,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("bigint");
  const [startWith, setStartWith] = useState("1");
  const [incrementBy, setIncrementBy] = useState("1");
  const [cycle, setCycle] = useState(false);
  const [cacheMode, setCacheMode] = useState<"default" | "cache" | "no-cache">(
    "default",
  );
  const [cacheSize, setCacheSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setDataType("bigint");
      setStartWith("1");
      setIncrementBy("1");
      setCycle(false);
      setCacheMode("default");
      setCacheSize("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError("Sequence name is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const cache =
        cacheMode === "cache"
          ? cacheSize.trim()
            ? Number(cacheSize.trim())
            : undefined
          : cacheMode === "no-cache"
            ? null
            : undefined;
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/sequences`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema,
            name: name.trim(),
            dataType,
            startWith,
            incrementBy,
            cycle,
            cache,
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Sequence created", {
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
          <DialogTitle>Create sequence</DialogTitle>
          <DialogDescription>
            in{" "}
            <span className="font-mono">
              {database}.{schema}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cs-name">Name</Label>
            <Input
              id="cs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OrderNumberSeq"
              spellCheck={false}
              autoFocus
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={dataType}
                onValueChange={(v) => v && setDataType(v)}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="font-mono text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cs-start">Start with</Label>
              <Input
                id="cs-start"
                value={startWith}
                onChange={(e) => setStartWith(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cs-incr">Increment by</Label>
              <Input
                id="cs-incr"
                value={incrementBy}
                onChange={(e) => setIncrementBy(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-2">
              <Label>Cache</Label>
              <Select
                value={cacheMode}
                onValueChange={(v) =>
                  v && setCacheMode(v as "default" | "cache" | "no-cache")
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default" className="text-xs">
                    Default
                  </SelectItem>
                  <SelectItem value="cache" className="text-xs">
                    CACHE n
                  </SelectItem>
                  <SelectItem value="no-cache" className="text-xs">
                    NO CACHE
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cacheMode === "cache" ? (
              <div className="space-y-2">
                <Label htmlFor="cs-cache">Cache size</Label>
                <Input
                  id="cs-cache"
                  value={cacheSize}
                  onChange={(e) => setCacheSize(e.target.value)}
                  placeholder="50"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Switch
              id="cs-cycle"
              size="sm"
              checked={cycle}
              onCheckedChange={setCycle}
            />
            <Label
              htmlFor="cs-cycle"
              className="cursor-pointer font-mono text-xs font-normal"
            >
              CYCLE
              <span className="text-muted-foreground ml-1.5">
                — wrap around when reaching max/min
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
