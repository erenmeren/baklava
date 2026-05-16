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
import type { SqlServerConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function SqlServerForm({ onSaved }: Props) {
  const [name, setName] = useState("Local SQL Server");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("1433");
  const [user, setUser] = useState("sa");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("master");
  const [encrypt, setEncrypt] = useState(true);
  const [trustServerCertificate, setTrustServerCertificate] = useState(true);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeInfo, setProbeInfo] = useState<{
    version: string;
    databaseCount: number;
  } | null>(null);

  const buildConfig = (): SqlServerConfig => ({
    host: host.trim(),
    port: Number(port) || 1433,
    user: user.trim(),
    password,
    database: database.trim() || "master",
    encrypt,
    trustServerCertificate,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbeInfo(null);
    try {
      const res = await fetch("/api/sqlserver/test", {
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
            description: `${data.probe.databaseCount} database(s) on this instance.`,
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
          Connect to a Microsoft SQL Server instance using SQL authentication.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="mssql-name">Name</Label>
          <Input
            id="mssql-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mssql-database">Database</Label>
          <Input
            id="mssql-database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div className="space-y-2">
          <Label htmlFor="mssql-host">Host</Label>
          <Input
            id="mssql-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mssql-port">Port</Label>
          <Input
            id="mssql-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="mssql-user">User</Label>
          <Input
            id="mssql-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mssql-password">Password</Label>
          <Input
            id="mssql-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="mssql-encrypt" className="cursor-pointer">
            Encrypt connection
          </Label>
          <Switch
            id="mssql-encrypt"
            checked={encrypt}
            onCheckedChange={setEncrypt}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="space-y-0.5">
            <Label
              htmlFor="mssql-trust"
              className="cursor-pointer"
            >
              Trust server certificate
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Required for self-signed certs in dev / private networks.
            </p>
          </div>
          <Switch
            id="mssql-trust"
            checked={trustServerCertificate}
            onCheckedChange={setTrustServerCertificate}
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
          Test &amp; save
        </Button>
      </div>

      {probeInfo ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription className="break-words">
            {probeInfo.version} · {probeInfo.databaseCount} database(s).
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
