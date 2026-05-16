"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import type { ChromaConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function ChromaForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Chroma");
  const [url, setUrl] = useState("http://localhost:8000");
  const [tenant, setTenant] = useState("default_tenant");
  const [database, setDatabase] = useState("default_database");
  const [authToken, setAuthToken] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    version: string;
    collectionCount: number;
  } | null>(null);

  const buildConfig = (): ChromaConfig => ({
    url: url.trim(),
    tenant: tenant.trim() || "default_tenant",
    database: database.trim() || "default_database",
    authToken: authToken.trim() || undefined,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/chroma/test", {
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
          toast.success("Chroma reachable", {
            description: `${data.probe.version} · ${data.probe.collectionCount} collection(s)`,
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
          Point Baklava at a Chroma REST endpoint. Tenant + database default to
          Chroma's standard names if your server is single-tenant.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="chroma-name">Name</Label>
          <Input
            id="chroma-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="chroma-url">URL</Label>
          <Input
            id="chroma-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:8000"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="chroma-tenant">Tenant</Label>
          <Input
            id="chroma-tenant"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="chroma-database">Database</Label>
          <Input
            id="chroma-database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="chroma-token">Auth token (optional)</Label>
        <Input
          id="chroma-token"
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="Chroma Cloud / token-auth deployments"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={() => test(false)}
          disabled={testing || !url.trim()}
          variant="outline"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button onClick={() => test(true)} disabled={testing || !url.trim()}>
          Test &amp; save
        </Button>
      </div>

      {probe ? (
        <Alert>
          <AlertTitle>Chroma reachable</AlertTitle>
          <AlertDescription>
            Server {probe.version} · {probe.collectionCount} collection
            {probe.collectionCount === 1 ? "" : "s"}.
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
