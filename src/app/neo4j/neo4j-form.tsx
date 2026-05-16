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
import type { Neo4jConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function Neo4jForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Neo4j");
  const [useAura, setUseAura] = useState(false);
  const [uri, setUri] = useState("bolt://localhost:7687");
  const [user, setUser] = useState("neo4j");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    name: string;
    versions: string[];
    edition: string;
  } | null>(null);

  const buildConfig = (): Neo4jConfig => ({
    uri: uri.trim(),
    user: user.trim(),
    password,
    database: database.trim() || undefined,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/neo4j/test", {
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
            description: `${data.probe.name} ${
              data.probe.versions?.[0] ?? ""
            } · ${data.probe.edition}`,
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
          Connect to a Neo4j server over the Bolt protocol.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="neo4j-name">Name</Label>
          <Input
            id="neo4j-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="neo4j-database">Database (optional)</Label>
          <Input
            id="neo4j-database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="leave blank for user default"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="neo4j-uri">Bolt URI</Label>
        <Input
          id="neo4j-uri"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder={
            useAura
              ? "neo4j+s://xxxx.databases.neo4j.io"
              : "bolt://localhost:7687"
          }
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="neo4j-user">User</Label>
          <Input
            id="neo4j-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="neo4j-password">Password</Label>
          <Input
            id="neo4j-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm rounded-lg border border-border/60 px-3 py-2">
        <div>
          <Label htmlFor="neo4j-aura" className="cursor-pointer">
            Aura / TLS
          </Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Toggle for Neo4j Aura or any TLS deployment.
          </p>
        </div>
        <Switch
          id="neo4j-aura"
          checked={useAura}
          onCheckedChange={(v) => {
            setUseAura(v);
            // Best-effort: nudge the URI scheme so users don't have to retype it.
            if (v && uri.startsWith("bolt://")) {
              setUri(uri.replace(/^bolt:\/\//, "neo4j+s://"));
            } else if (!v && uri.startsWith("neo4j+s://")) {
              setUri(uri.replace(/^neo4j\+s:\/\//, "bolt://"));
            }
          }}
        />
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
            {probe.name} {probe.versions?.[0] ?? ""}
            {probe.edition ? ` · ${probe.edition} edition` : ""}
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
