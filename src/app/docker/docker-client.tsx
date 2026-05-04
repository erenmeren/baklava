"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConnectionsList } from "@/components/connections-list";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import type { DockerConfig } from "@/lib/connections/types";

interface DockerInfo {
  version: string;
  apiVersion: string;
  os: string;
  arch: string;
}

export function DockerClient() {
  const [mode, setMode] = useState<"socket" | "tcp">("socket");
  const [name, setName] = useState("Local Docker");
  const [socketPath, setSocketPath] = useState("/var/run/docker.sock");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("2375");
  const [protocol, setProtocol] = useState<"http" | "https">("http");

  const [testing, setTesting] = useState(false);
  const [info, setInfo] = useState<DockerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const buildConfig = (): DockerConfig =>
    mode === "tcp"
      ? { mode: "tcp", host, port: Number(port), protocol }
      : { mode: "socket", socketPath };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/docker/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setInfo(data.info as DockerInfo);
        if (save) {
          toast.success("Connection saved");
          setRefresh((n) => n + 1);
        } else {
          toast.success("Connection works");
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
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <Card className="p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="font-semibold">New connection</h2>
          <p className="text-sm text-muted-foreground">
            Connect via the local Docker socket or a remote daemon over TCP.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="docker-name">Name</Label>
          <Input
            id="docker-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Local Docker"
          />
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="socket">Unix socket</TabsTrigger>
            <TabsTrigger value="tcp">TCP</TabsTrigger>
          </TabsList>
          <TabsContent value="socket" className="space-y-3 pt-4">
            <div className="space-y-2">
              <Label htmlFor="docker-socket">Socket path</Label>
              <Input
                id="docker-socket"
                value={socketPath}
                onChange={(e) => setSocketPath(e.target.value)}
                placeholder="/var/run/docker.sock"
                spellCheck={false}
              />
            </div>
          </TabsContent>
          <TabsContent value="tcp" className="space-y-3 pt-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="docker-host">Host</Label>
                <Input
                  id="docker-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="docker-port">Port</Label>
                <Input
                  id="docker-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="docker-protocol">Protocol</Label>
              <select
                id="docker-protocol"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={protocol}
                onChange={(e) =>
                  setProtocol(e.target.value as "http" | "https")
                }
              >
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </div>
          </TabsContent>
        </Tabs>

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

        {info ? (
          <Alert>
            <AlertTitle>Daemon reachable</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              v{info.version} · API {info.apiVersion} · {info.os}/{info.arch}
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

      <section>
        <h2 className="font-semibold mb-3">Saved connections</h2>
        <ConnectionsList
          tech="docker"
          refreshKey={refresh}
          renderSummary={(r) => {
            const cfg = r.config as DockerConfig;
            return cfg.mode === "tcp"
              ? `${cfg.protocol}://${cfg.host}:${cfg.port}`
              : `socket: ${cfg.socketPath}`;
          }}
        />
      </section>
    </div>
  );
}
