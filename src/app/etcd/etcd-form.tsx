"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, EtcdConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

function parseHosts(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EtcdForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as EtcdConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local etcd");
  const [hosts, setHosts] = useState(
    init?.hosts?.join("\n") ?? "http://localhost:2379",
  );
  const [user, setUser] = useState(init?.user ?? "");
  const [password, setPassword] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    version: string;
    memberCount: number;
  } | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      hosts: parseHosts(hosts),
      user: user ? user : undefined,
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = undefined;
    return cfg;
  };

  const test = async (save: boolean) => {
    const config = buildConfig();
    if (
      !Array.isArray(config.hosts) ||
      (config.hosts as string[]).length === 0
    ) {
      toast.error("At least one host required");
      return;
    }
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      if (save && editing && initial) {
        const res = await fetch(`/api/connections/${initial.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, config }),
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
      const res = await fetch("/api/etcd/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config, save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Cluster reachable", {
            description: `${data.probe.memberCount} member(s) · etcd ${data.probe.version}`,
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
          Connect to an etcd cluster. One host per line. Auth is optional.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="etcd-name">Name</Label>
        <Input
          id="etcd-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="etcd-hosts">Hosts (one per line)</Label>
        <Textarea
          id="etcd-hosts"
          value={hosts}
          onChange={(e) => setHosts(e.target.value)}
          placeholder="http://localhost:2379"
          spellCheck={false}
          rows={3}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="etcd-user">Username (optional)</Label>
          <Input
            id="etcd-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="etcd-pass">Password</Label>
          <Input
            id="etcd-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={
              editing && init?.password
                ? "(unchanged — leave blank to keep)"
                : ""
            }
          />
        </div>
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
          <AlertTitle>Cluster reachable</AlertTitle>
          <AlertDescription>
            etcd {probe.version} · {probe.memberCount} member
            {probe.memberCount === 1 ? "" : "s"}
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
