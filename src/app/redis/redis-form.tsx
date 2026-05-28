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
import { cn } from "@/lib/utils";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

type Mode = "single" | "cluster";

interface Probe {
  version: string;
  mode: string;
  role: string;
  databases: number;
  modules: { name: string; version: string }[];
}

export function RedisForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as RedisConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local Redis");
  const [mode, setMode] = useState<Mode>(init?.mode ?? "single");
  const [host, setHost] = useState(init?.host ?? "127.0.0.1");
  const [port, setPort] = useState(String(init?.port ?? 6379));
  const [nodes, setNodes] = useState(
    init?.nodes ?? "127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002",
  );
  const [username, setUsername] = useState(init?.username ?? "");
  const [password, setPassword] = useState("");
  const [db, setDb] = useState(String(init?.db ?? 0));
  const [tls, setTls] = useState(init?.tls ?? false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = { mode, tls };
    if (mode === "single") {
      cfg.host = host.trim() || "127.0.0.1";
      cfg.port = Number(port) || 6379;
      cfg.db = Number(db) || 0;
    } else {
      cfg.nodes = nodes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",");
    }
    if (username) cfg.username = username.trim();
    // password: omit when editing + blank so backend keeps the secret
    if (password) cfg.password = password;
    else if (!editing) cfg.password = "";
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
            description: `Redis ${data.probe.version} · ${data.probe.role}`,
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
          Connect to a single Redis instance or a cluster of seed nodes.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="redis-name">Name</Label>
        <Input
          id="redis-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Topology</Label>
        <div className="inline-flex rounded-md border border-input p-0.5 bg-background">
          {(["single", "cluster"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1 text-sm rounded-sm transition-colors",
                mode === m
                  ? "bg-foreground/8 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "single" ? "Single instance" : "Cluster"}
            </button>
          ))}
        </div>
      </div>

      {mode === "single" ? (
        <div className="grid grid-cols-[1fr_120px_80px] gap-3">
          <div className="space-y-2">
            <Label htmlFor="redis-host">Host</Label>
            <Input
              id="redis-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="redis-port">Port</Label>
            <Input
              id="redis-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="redis-db">DB</Label>
            <Input
              id="redis-db"
              type="number"
              min={0}
              max={15}
              value={db}
              onChange={(e) => setDb(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="redis-nodes">Seed nodes (comma separated)</Label>
          <Input
            id="redis-nodes"
            value={nodes}
            onChange={(e) => setNodes(e.target.value)}
            placeholder="host1:7000, host2:7000, host3:7000"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            ioredis discovers the rest of the cluster topology from any
            reachable seed.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="redis-user">Username (Redis 6+ ACL)</Label>
          <Input
            id="redis-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="default"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="redis-pass">Password</Label>
          <Input
            id="redis-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              editing && init?.password
                ? "(unchanged — leave blank to keep)"
                : ""
            }
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="redis-tls" className="cursor-pointer">
          Use TLS (rediss://)
        </Label>
        <Switch id="redis-tls" checked={tls} onCheckedChange={setTls} />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => test(false)} disabled={testing} variant="outline">
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
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>
            Redis {probe.version} · {probe.role} · {probe.databases} db(s)
            {probe.modules.length > 0 ? (
              <span className="block text-[11px] mt-1 text-muted-foreground">
                modules: {probe.modules.map((m) => `${m.name} v${m.version}`).join(", ")}
              </span>
            ) : null}
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
