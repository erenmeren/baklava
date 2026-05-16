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
import type { MongoConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function MongoForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Mongo");

  const [useUri, setUseUri] = useState(false);
  const [uri, setUri] = useState("");

  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("27017");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [authSource, setAuthSource] = useState("admin");
  const [tls, setTls] = useState(false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    version: string;
    databaseCount: number;
  } | null>(null);

  const buildConfig = (): MongoConfig => {
    if (useUri && uri.trim()) {
      return { uri: uri.trim() };
    }
    return {
      host,
      port: Number(port) || 27017,
      user: user || undefined,
      password: password || undefined,
      database: database || undefined,
      authSource: authSource || undefined,
      tls,
    };
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/mongo/test", {
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
            description: `MongoDB ${data.probe.version} · ${data.probe.databaseCount} db(s)`,
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
          Connect to a MongoDB server using a connection string or structured fields.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mongo-name">Name</Label>
        <Input
          id="mongo-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="mongo-use-uri" className="cursor-pointer">
            Use connection URI
          </Label>
          <Switch
            id="mongo-use-uri"
            checked={useUri}
            onCheckedChange={setUseUri}
          />
        </div>
        {useUri ? (
          <div className="space-y-2">
            <Label htmlFor="mongo-uri">Connection string</Label>
            <Textarea
              id="mongo-uri"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="mongodb://user:pass@host:port/db?authSource=admin"
              spellCheck={false}
              rows={3}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              When set, the URI overrides every structured field below.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="mongo-host">Host</Label>
                <Input
                  id="mongo-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mongo-port">Port</Label>
                <Input
                  id="mongo-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="mongo-user">User</Label>
                <Input
                  id="mongo-user"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mongo-pass">Password</Label>
                <Input
                  id="mongo-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="mongo-db">Database</Label>
                <Input
                  id="mongo-db"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="(optional)"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mongo-auth">Auth source</Label>
                <Input
                  id="mongo-auth"
                  value={authSource}
                  onChange={(e) => setAuthSource(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor="mongo-tls" className="cursor-pointer">
                Use TLS
              </Label>
              <Switch
                id="mongo-tls"
                checked={tls}
                onCheckedChange={setTls}
              />
            </div>
          </div>
        )}
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

      {probe ? (
        <Alert>
          <AlertTitle>Server reachable</AlertTitle>
          <AlertDescription>
            MongoDB {probe.version} · {probe.databaseCount} database
            {probe.databaseCount === 1 ? "" : "s"}.
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
