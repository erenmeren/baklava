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
import type { ConnectionRecord, ElasticConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

export function ElasticForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as ElasticConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local Elasticsearch");
  const [nodesText, setNodesText] = useState(
    init?.nodes?.join("\n") ?? "http://localhost:9200",
  );
  // Default the toggle to whichever mode the existing record uses.
  const [useApiKey, setUseApiKey] = useState(Boolean(init?.apiKey));
  const [user, setUser] = useState(init?.user ?? "");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    name: string;
    clusterName: string;
    version: string;
  } | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      nodes: nodesText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (useApiKey) {
      cfg.user = undefined;
      cfg.password = undefined;
      if (apiKey) cfg.apiKey = apiKey;
      else if (!editing) cfg.apiKey = undefined;
    } else {
      cfg.user = user || undefined;
      cfg.apiKey = undefined;
      if (password) cfg.password = password;
      else if (!editing) cfg.password = undefined;
    }
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
      const res = await fetch("/api/elastic/test", {
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
            description: `${data.probe.clusterName || "cluster"} · v${data.probe.version}`,
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
          Connect to an Elasticsearch cluster. One node URL per line.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="es-name">Name</Label>
        <Input
          id="es-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="es-nodes">Nodes</Label>
        <Textarea
          id="es-nodes"
          value={nodesText}
          onChange={(e) => setNodesText(e.target.value)}
          placeholder="https://node-1:9200&#10;https://node-2:9200"
          spellCheck={false}
          className="font-mono text-xs min-h-24"
        />
        <p className="text-xs text-muted-foreground">
          One URL per line (or comma-separated).
        </p>
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="es-apikey-toggle" className="cursor-pointer">
            Use API key
          </Label>
          <Switch
            id="es-apikey-toggle"
            checked={useApiKey}
            onCheckedChange={setUseApiKey}
          />
        </div>
        {useApiKey ? (
          <div className="space-y-2">
            <Label htmlFor="es-apikey">API key</Label>
            <Input
              id="es-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                editing && init?.apiKey
                  ? "(unchanged — leave blank to keep)"
                  : "base64-encoded id:api_key"
              }
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="es-user">Username</Label>
              <Input
                id="es-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="elastic"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="es-pass">Password</Label>
              <Input
                id="es-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  editing && init?.password
                    ? "(unchanged — leave blank to keep)"
                    : ""
                }
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
          <AlertTitle>Cluster reachable</AlertTitle>
          <AlertDescription>
            {probe.clusterName || "cluster"} · node{" "}
            <span className="font-mono">{probe.name}</span> · v{probe.version}
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
