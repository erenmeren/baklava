"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, MysqlConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function MysqlForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as MysqlConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local MySQL");
  const [host, setHost] = useState(init?.host ?? "localhost");
  const [port, setPort] = useState(String(init?.port ?? "3306"));
  const [database, setDatabase] = useState(init?.database ?? "");
  const [user, setUser] = useState(init?.user ?? "root");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(init?.ssl ?? false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeText, setProbeText] = useState<string | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      host,
      port: Number(port),
      database,
      user,
      ssl,
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = "";
    return cfg;
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setProbeText(null);
    try {
      const probePassword = password || (editing ? init?.password ?? "" : "");
      const res = await fetch("/api/mysql/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          config: { ...buildConfig(), password: probePassword },
          save: false,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const v = (data.probe.serverVersion as string).split("-")[0] ?? "";
        const db = data.probe.currentDatabase || "(none)";
        setProbeText(
          `MySQL ${v} · db ${db} · user ${data.probe.currentUser}`
        );
        toast.success("Connection works");
      } else {
        setError(data.error || "Connection failed");
        toast.error("Connection failed", { description: data.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setProbeText(null);
    try {
      if (editing && initial) {
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
      const res = await fetch("/api/mysql/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          config: { ...buildConfig(), password },
          save: true,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success("Connection saved");
        onSaved?.();
      } else {
        setError(data.error || "Connection failed");
        toast.error("Connection failed", { description: data.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect to any MySQL or MariaDB-compatible server.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="my-name">Name</Label>
        <Input
          id="my-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="my-host">Host</Label>
          <Input
            id="my-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="my-port">Port</Label>
          <Input
            id="my-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="my-db">Database (optional)</Label>
        <Input
          id="my-db"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder="leave blank to browse all databases"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="my-user">User</Label>
          <Input
            id="my-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="my-pass">Password</Label>
          <Input
            id="my-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing ? "(unchanged — leave blank to keep)" : ""}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="my-ssl" className="cursor-pointer">
          Use SSL
        </Label>
        <Switch id="my-ssl" checked={ssl} onCheckedChange={setSsl} />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={test} disabled={busy} variant="outline">
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button onClick={save} disabled={busy}>
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {probeText ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {probeText}
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
