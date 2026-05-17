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
import type { ConnectionRecord, RabbitConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function RabbitForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as RabbitConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local RabbitMQ");
  const [host, setHost] = useState(init?.host ?? "localhost");
  const [port, setPort] = useState(String(init?.port ?? "5672"));
  const [vhost, setVhost] = useState(init?.vhost ?? "/");
  const [user, setUser] = useState(init?.user ?? "guest");
  const [password, setPassword] = useState(editing ? "" : "guest");
  const [tls, setTls] = useState(init?.tls ?? false);
  const [managementPort, setManagementPort] = useState(
    String(init?.managementPort ?? "15672"),
  );

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mgmtWarning, setMgmtWarning] = useState<string | null>(null);
  const [okInfo, setOkInfo] = useState<{
    rabbitVersion?: string;
    erlangVersion?: string;
    clusterName?: string;
  } | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      host: host.trim(),
      port: Math.max(1, Number(port) || 5672),
      vhost: vhost || "/",
      user: user || "guest",
      tls,
      managementPort: Math.max(1, Number(managementPort) || 15672),
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = "";
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setMgmtWarning(null);
    setOkInfo(null);
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
      const res = await fetch("/api/rabbit/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setOkInfo({
          rabbitVersion: data.probe.rabbitVersion,
          erlangVersion: data.probe.erlangVersion,
          clusterName: data.probe.clusterName,
        });
        if (data.probe.managementError) {
          setMgmtWarning(data.probe.managementError);
        }
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Connection works", {
            description: data.probe.rabbitVersion
              ? `RabbitMQ ${data.probe.rabbitVersion}`
              : "AMQP reachable",
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
          Connect to a RabbitMQ broker. Listings use the management HTTP API.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rabbit-name">Name</Label>
          <Input
            id="rabbit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rabbit-vhost">Vhost</Label>
          <Input
            id="rabbit-vhost"
            value={vhost}
            onChange={(e) => setVhost(e.target.value)}
            placeholder="/"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2 col-span-2">
          <Label htmlFor="rabbit-host">Host</Label>
          <Input
            id="rabbit-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="localhost"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rabbit-port">Port</Label>
          <Input
            id="rabbit-port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rabbit-user">Username</Label>
          <Input
            id="rabbit-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rabbit-pass">Password</Label>
          <Input
            id="rabbit-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing ? "(unchanged — leave blank to keep)" : ""}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="rabbit-tls" className="cursor-pointer">
            Use TLS (amqps / https)
          </Label>
          <Switch id="rabbit-tls" checked={tls} onCheckedChange={setTls} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rabbit-mgmt">Management port</Label>
          <Input
            id="rabbit-mgmt"
            value={managementPort}
            onChange={(e) => setManagementPort(e.target.value)}
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">
            Default 15672. Required for queue listings — the broker needs the
            <span className="font-mono"> rabbitmq_management </span>
            plugin enabled.
          </p>
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

      {okInfo ? (
        <Alert>
          <AlertTitle>Broker reachable</AlertTitle>
          <AlertDescription>
            {okInfo.rabbitVersion
              ? `RabbitMQ ${okInfo.rabbitVersion}`
              : "AMQP reachable"}
            {okInfo.erlangVersion ? ` · Erlang ${okInfo.erlangVersion}` : ""}
            {okInfo.clusterName ? ` · ${okInfo.clusterName}` : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      {mgmtWarning ? (
        <Alert>
          <AlertTitle>Management API unreachable</AlertTitle>
          <AlertDescription className="break-words text-xs">
            {mgmtWarning} — enable the{" "}
            <span className="font-mono">rabbitmq_management</span> plugin to
            browse queues.
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
