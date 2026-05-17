"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, QdrantConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function QdrantForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as QdrantConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local Qdrant");
  const [url, setUrl] = useState(init?.url ?? "http://localhost:6333");
  const [apiKey, setApiKey] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionCount, setCollectionCount] = useState<number | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = { url: url.trim() };
    if (apiKey.trim()) cfg.apiKey = apiKey.trim();
    else if (!editing) cfg.apiKey = undefined;
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setCollectionCount(null);
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
      const res = await fetch("/api/qdrant/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setCollectionCount(data.probe.collectionCount);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Qdrant reachable", {
            description: `${data.probe.collectionCount} collection(s)`,
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
          Point Baklava at a Qdrant REST endpoint. API key is optional for
          local / unsecured deployments.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="qdrant-name">Name</Label>
        <Input
          id="qdrant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="qdrant-url">URL</Label>
        <Input
          id="qdrant-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:6333"
          spellCheck={false}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="qdrant-apikey">API key (optional)</Label>
        <Input
          id="qdrant-apikey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            editing && init?.apiKey
              ? "(unchanged — leave blank to keep)"
              : "leave blank for unsecured"
          }
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
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {collectionCount !== null ? (
        <Alert>
          <AlertTitle>Qdrant reachable</AlertTitle>
          <AlertDescription>
            {collectionCount} collection(s) visible.
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
