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
  const [user, setUser] = useState(init?.user ?? "root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState(init?.database ?? "");
  const [ssl, setSsl] = useState(init?.ssl ?? false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<{
    version: string;
    databaseCount: number;
  } | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      host: host.trim(),
      port: Number(port) || 3306,
      user: user.trim(),
      database: database.trim(),
      ssl,
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = "";
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbeInfo(null);
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
      const res = await fetch("/api/mysql/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbeInfo(data.probe);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Connection works", {
            description: `MySQL ${data.probe.version} · ${data.probe.databaseCount} database(s)`,
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
          Connect to a MySQL or MariaDB server. Username and password required.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="mysql-name">Name</Label>
          <Input
            id="mysql-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mysql-database">Database (optional)</Label>
          <Input
            id="mysql-database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="leave blank for server-level"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div className="space-y-2">
          <Label htmlFor="mysql-host">Host</Label>
          <Input
            id="mysql-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mysql-port">Port</Label>
          <Input
            id="mysql-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="mysql-user">User</Label>
          <Input
            id="mysql-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mysql-password">Password</Label>
          <Input
            id="mysql-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing ? "(unchanged — leave blank to keep)" : ""}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="mysql-ssl" className="cursor-pointer">
          Use SSL/TLS
        </Label>
        <Switch id="mysql-ssl" checked={ssl} onCheckedChange={setSsl} />
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

      {probeInfo ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription>
            MySQL {probeInfo.version} · {probeInfo.databaseCount} database(s).
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
