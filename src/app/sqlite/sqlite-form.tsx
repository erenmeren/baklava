"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import type { SqliteConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function SqliteForm({ onSaved }: Props) {
  const [name, setName] = useState("Local SQLite");
  const [filePath, setFilePath] = useState("");
  const [readonly, setReadonly] = useState(false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    version: string;
    tableCount: number;
  } | null>(null);

  const buildConfig = (): SqliteConfig => ({
    filePath: filePath.trim(),
    readonly,
  });

  const test = async (save: boolean) => {
    if (!filePath.trim()) {
      toast.error("File path is required");
      return;
    }
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/sqlite/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Database opened", {
            description: `SQLite ${data.probe.version} · ${data.probe.tableCount} table(s)`,
          });
        }
      } else {
        setError(data.error || "Could not open file");
        toast.error("Could not open file", { description: data.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">New connection</h2>
        <p className="text-sm text-muted-foreground">
          Point Baklava at a SQLite file on the server.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sqlite-name">Name</Label>
        <Input
          id="sqlite-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sqlite-path">File path</Label>
        <Input
          id="sqlite-path"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="/absolute/path/to/database.sqlite"
          spellCheck={false}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Must be an absolute path readable by the Baklava server process.
        </p>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="space-y-0.5">
          <Label htmlFor="sqlite-readonly" className="cursor-pointer">
            Open read-only
          </Label>
          <p className="text-xs text-muted-foreground">
            Disable mutating queries from this connection.
          </p>
        </div>
        <Switch
          id="sqlite-readonly"
          checked={readonly}
          onCheckedChange={setReadonly}
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={() => test(false)}
          disabled={testing}
          variant="outline"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button onClick={() => test(true)} disabled={testing}>
          Test &amp; save
        </Button>
      </div>

      {probe ? (
        <Alert>
          <AlertTitle>Database opened</AlertTitle>
          <AlertDescription>
            SQLite {probe.version} · {probe.tableCount} user table
            {probe.tableCount === 1 ? "" : "s"}.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not open</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}
    </Card>
  );
}
