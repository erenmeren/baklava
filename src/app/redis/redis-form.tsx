"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, RedisConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function RedisForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as RedisConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local Redis");
  const [host, setHost] = useState(init?.host ?? "localhost");
  const [port, setPort] = useState(String(init?.port ?? "6379"));
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(init?.tls ?? false);
  const [database, setDatabase] = useState(String(init?.database ?? "0"));

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ version: string; role: string } | null>(
    null
  );

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      host: host.trim(),
      port: Math.max(1, Number(port) || 6379),
      tls,
      database: Math.max(0, Math.min(15, Number(database) || 0)),
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = undefined;
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
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
      const res = await fetch("/api/redis/test", {
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
          toast.success("Connection works", {
            description: `Redis ${data.probe.version} (${data.probe.role})`,
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
          Connect to a Redis server. Supports password auth and TLS.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="redis-name">Name</Label>
          <Input
            id="redis-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="redis-db">Database</Label>
          <Input
            id="redis-db"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            inputMode="numeric"
            placeholder="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div className="space-y-2">
          <Label htmlFor="redis-host">Host</Label>
          <Input
            id="redis-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="localhost"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="redis-port">Port</Label>
          <Input
            id="redis-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="redis-pass">Password (optional)</Label>
        <Input
          id="redis-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={editing ? "(unchanged — leave blank to keep)" : ""}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="redis-tls" className="cursor-pointer">
          Use TLS
        </Label>
        <Switch id="redis-tls" checked={tls} onCheckedChange={setTls} />
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

      {probe ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription>
            Redis {probe.version} · role {probe.role}
          </AlertDescription>
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
