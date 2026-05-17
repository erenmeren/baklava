"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type {
  ClickhouseConfig,
  ConnectionRecord,
} from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function ClickhouseForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as ClickhouseConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local ClickHouse");
  const [url, setUrl] = useState(init?.url ?? "http://localhost:8123");
  const [user, setUser] = useState(init?.user ?? "default");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState(init?.database ?? "default");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      url: url.trim(),
      user: user.trim() || "default",
      database: database.trim() || "default",
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = "";
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setVersion(null);
    try {
      if (save && editing && initial) {
        const res = await fetch(`/api/connections/${initial.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, config: buildConfig() }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success("Connection updated");
          onSaved?.();
        } else {
          setError(data.error || "Update failed");
          toast.error("Update failed", { description: data.error });
        }
        return;
      }
      const res = await fetch("/api/clickhouse/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setVersion(data.probe.version);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Connection works", {
            description: `ClickHouse v${data.probe.version}`,
          });
        }
      } else {
        setError(data.error || "Connection failed");
        toast.error("Connection failed", { description: data.error });
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
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect to a ClickHouse server over its HTTP interface (port 8123 by
          default).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ch-name">Name</Label>
        <Input
          id="ch-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ch-url">URL</Label>
        <Input
          id="ch-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8123"
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="ch-user">User</Label>
          <Input
            id="ch-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ch-pass">Password</Label>
          <Input
            id="ch-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing ? "(unchanged — leave blank to keep)" : ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ch-db">Database</Label>
        <Input
          id="ch-db"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
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
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {version ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription>ClickHouse v{version}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}
    </Card>
  );
}
