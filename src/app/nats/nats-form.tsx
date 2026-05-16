"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import type { NatsConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

type AuthMode = "userpass" | "token";

export function NatsForm({ onSaved }: Props) {
  const [name, setName] = useState("Local NATS");
  const [servers, setServers] = useState("nats://localhost:4222");
  const [useAuth, setUseAuth] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("userpass");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    serverName?: string;
    serverVersion?: string;
    jetstream?: boolean;
    cluster?: string;
  } | null>(null);

  const parseServers = (): string[] =>
    servers
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const buildConfig = (): NatsConfig => {
    const cfg: NatsConfig = { servers: parseServers() };
    if (useAuth) {
      if (authMode === "token") {
        if (token) cfg.token = token;
      } else {
        if (user) cfg.user = user;
        if (password) cfg.password = password;
      }
    }
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/nats/test", {
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
            description: data.probe.serverVersion
              ? `NATS ${data.probe.serverVersion}${data.probe.jetstream ? " · JetStream" : ""}`
              : "Server reachable",
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
          Connect to one or more NATS servers. JetStream is auto-detected.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nats-name">Name</Label>
        <Input
          id="nats-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nats-servers">Servers (one per line)</Label>
        <Textarea
          id="nats-servers"
          value={servers}
          onChange={(e) => setServers(e.target.value)}
          placeholder="nats://localhost:4222"
          spellCheck={false}
          rows={3}
          className="font-mono text-xs"
        />
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="nats-auth" className="cursor-pointer">
            Use authentication
          </Label>
          <Switch
            id="nats-auth"
            checked={useAuth}
            onCheckedChange={setUseAuth}
          />
        </div>
        {useAuth ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <div className="inline-flex rounded-md border border-border/60 p-0.5">
                <button
                  type="button"
                  onClick={() => setAuthMode("userpass")}
                  className={
                    "px-2.5 py-1 rounded-[5px] transition-colors " +
                    (authMode === "userpass"
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  User / password
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("token")}
                  className={
                    "px-2.5 py-1 rounded-[5px] transition-colors " +
                    (authMode === "token"
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  Token
                </button>
              </div>
            </div>
            {authMode === "userpass" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="nats-user">Username</Label>
                  <Input
                    id="nats-user"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nats-pass">Password</Label>
                  <Input
                    id="nats-pass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="nats-token">Token</Label>
                <Input
                  id="nats-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={() => test(false)}
          disabled={testing || parseServers().length === 0}
          variant="outline"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button
          onClick={() => test(true)}
          disabled={testing || parseServers().length === 0}
        >
          Test &amp; save
        </Button>
      </div>

      {probe ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription>
            {probe.serverName ?? "nats"}
            {probe.serverVersion ? ` · v${probe.serverVersion}` : ""}
            {probe.cluster ? ` · cluster ${probe.cluster}` : ""}
            {probe.jetstream
              ? " · JetStream enabled"
              : " · JetStream disabled"}
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
