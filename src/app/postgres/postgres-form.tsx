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
import type {
  ConnectionRecord,
  PostgresConfig,
} from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function PostgresForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as PostgresConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local Postgres");
  const [host, setHost] = useState(init?.host ?? "localhost");
  const [port, setPort] = useState(String(init?.port ?? "5432"));
  const [database, setDatabase] = useState(init?.database ?? "postgres");
  const [user, setUser] = useState(init?.user ?? "postgres");
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
    // Only include password when the user actually typed one — empty means
    // "keep existing" on edit, or no auth on create.
    if (password) cfg.password = password;
    else if (!editing) cfg.password = "";
    return cfg;
  };

  // Probe with current values (no save). Works in both modes.
  const test = async () => {
    setBusy(true);
    setError(null);
    setProbeText(null);
    try {
      const probePassword = password || (editing ? init?.password ?? "" : "");
      const res = await fetch("/api/postgres/test", {
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
        const v = (data.probe.serverVersion as string).split(" ")[1] ?? "";
        setProbeText(
          `Postgres ${v} · db ${data.probe.currentDatabase} · user ${data.probe.currentUser}`,
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

  // Create: probe + save. Edit: PATCH (no probe — backend marks untested).
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
      const res = await fetch("/api/postgres/test", {
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
          Connect to any PostgreSQL-compatible server.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pg-name">Name</Label>
        <Input
          id="pg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="pg-host">Host</Label>
          <Input
            id="pg-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pg-port">Port</Label>
          <Input
            id="pg-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pg-db">Database</Label>
        <Input
          id="pg-db"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="pg-user">User</Label>
          <Input
            id="pg-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pg-pass">Password</Label>
          <Input
            id="pg-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing ? "(unchanged — leave blank to keep)" : ""}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="pg-ssl" className="cursor-pointer">
          Use SSL
        </Label>
        <Switch id="pg-ssl" checked={ssl} onCheckedChange={setSsl} />
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
