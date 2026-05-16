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
import type { MysqlConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function MysqlForm({ onSaved }: Props) {
  const [name, setName] = useState("Local MySQL");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [ssl, setSsl] = useState(false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<{
    version: string;
    databaseCount: number;
  } | null>(null);

  const buildConfig = (): MysqlConfig => ({
    host: host.trim(),
    port: Number(port) || 3306,
    user: user.trim(),
    password,
    database: database.trim(),
    ssl,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbeInfo(null);
    try {
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
        <h2 className="font-semibold">New connection</h2>
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
          Test &amp; save
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
