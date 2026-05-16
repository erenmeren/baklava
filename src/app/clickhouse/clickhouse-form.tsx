"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import type { ClickhouseConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function ClickhouseForm({ onSaved }: Props) {
  const [name, setName] = useState("Local ClickHouse");
  const [url, setUrl] = useState("http://localhost:8123");
  const [user, setUser] = useState("default");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("default");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const buildConfig = (): ClickhouseConfig => ({
    url: url.trim(),
    user: user.trim() || "default",
    password,
    database: database.trim() || "default",
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setVersion(null);
    try {
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
        <h2 className="font-semibold">New connection</h2>
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
          Test &amp; save
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
