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
import type { RedisConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function RedisForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Redis");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("6379");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(false);
  const [database, setDatabase] = useState("0");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ version: string; role: string } | null>(
    null
  );

  const buildConfig = (): RedisConfig => ({
    host: host.trim(),
    port: Math.max(1, Number(port) || 6379),
    password: password ? password : undefined,
    tls,
    database: Math.max(0, Math.min(15, Number(database) || 0)),
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
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
        <h2 className="font-semibold">New connection</h2>
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
          Test &amp; save
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
