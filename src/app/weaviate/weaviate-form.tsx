"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import type { WeaviateConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function WeaviateForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Weaviate");
  const [url, setUrl] = useState("http://localhost:8080");
  const [apiKey, setApiKey] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    collectionCount: number;
    version?: string;
  } | null>(null);

  const buildConfig = (): WeaviateConfig => ({
    url: url.trim(),
    apiKey: apiKey.trim() || undefined,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/weaviate/test", {
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
          toast.success("Weaviate reachable", {
            description: `${data.probe.collectionCount} collection(s)${data.probe.version ? ` · v${data.probe.version}` : ""}`,
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
          Point Baklava at a Weaviate REST endpoint. The client also opens a
          gRPC channel on port 50051 of the same host for object queries — see
          AGENTS.md for the rationale.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="weaviate-name">Name</Label>
        <Input
          id="weaviate-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="weaviate-url">URL</Label>
        <Input
          id="weaviate-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:8080"
          spellCheck={false}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="weaviate-apikey">API key (optional)</Label>
        <Input
          id="weaviate-apikey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="leave blank for anonymous"
          spellCheck={false}
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
          <AlertTitle>Weaviate reachable</AlertTitle>
          <AlertDescription>
            {probe.collectionCount} collection(s)
            {probe.version ? ` · v${probe.version}` : ""}
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
