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
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, MongoConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function MongoForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as MongoConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local Mongo");

  // Default the toggle to the mode the existing record uses (URI vs structured).
  const [useUri, setUseUri] = useState(Boolean(init?.uri));
  // The URI string can embed credentials inline — treat it like a secret.
  const [uri, setUri] = useState("");

  const [host, setHost] = useState(init?.host ?? "localhost");
  const [port, setPort] = useState(String(init?.port ?? "27017"));
  const [user, setUser] = useState(init?.user ?? "");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState(init?.database ?? "");
  const [authSource, setAuthSource] = useState(init?.authSource ?? "admin");
  const [tls, setTls] = useState(init?.tls ?? false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    version: string;
    databaseCount: number;
  } | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    if (useUri) {
      // Editing and user left URI blank → omit so backend keeps existing.
      // Creating → always send the (possibly empty) URI.
      const trimmed = uri.trim();
      if (trimmed) return { uri: trimmed };
      if (editing) return {};
      return { uri: "" };
    }
    const cfg: Record<string, unknown> = {
      host,
      port: Number(port) || 27017,
      user: user || undefined,
      database: database || undefined,
      authSource: authSource || undefined,
      tls,
    };
    if (password) cfg.password = password;
    else if (!editing) cfg.password = undefined;
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
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
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
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
              placeholder={
                editing && init?.uri
                  ? "(unchanged — leave blank to keep)"
                  : "mongodb://user:pass@host:port/db?authSource=admin"
              }
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
                  placeholder={
                    editing ? "(unchanged — leave blank to keep)" : ""
                  }
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
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
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
