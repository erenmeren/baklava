"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, MongoConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

interface Probe {
  version: string;
  topology: string;
  databases: number;
  totalSize: number;
}

function formatBytes(b: number): string {
  if (!b) return "0";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

export function MongoForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as MongoConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local MongoDB");
  const [uri, setUri] = useState("");
  const [defaultDb, setDefaultDb] = useState(init?.defaultDb ?? "");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = { defaultDb: defaultDb.trim() };
    // URI is a secret — omit when editing + blank so backend keeps the
    // existing one. Send empty string on first create so the validator
    // sees the field present.
    if (uri) cfg.uri = uri;
    else if (!editing) cfg.uri = "";
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
            description: `MongoDB ${data.probe.version} · ${data.probe.topology}`,
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

  const testDisabled = testing || (editing && !uri && !init?.uri);

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Paste a MongoDB connection string. Works with self-hosted (
          <code className="text-[11px]">mongodb://</code>) and Atlas/SRV (
          <code className="text-[11px]">mongodb+srv://</code>) URIs.
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

      <div className="space-y-2">
        <Label htmlFor="mongo-uri">Connection URI</Label>
        <Input
          id="mongo-uri"
          type="password"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            editing && init?.uri
              ? "(unchanged — leave blank to keep)"
              : "mongodb://user:pass@host:27017/?replicaSet=rs0"
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Stored encrypted-at-rest as a secret — credentials are never returned
          over the API.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mongo-db">Default database (optional)</Label>
        <Input
          id="mongo-db"
          value={defaultDb}
          onChange={(e) => setDefaultDb(e.target.value)}
          placeholder="admin"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={() => test(false)}
          disabled={testDisabled}
          variant="outline"
          title={
            editing && !uri && !init?.uri
              ? "Paste the URI to test"
              : undefined
          }
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
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>
            MongoDB {probe.version} · {probe.topology} · {probe.databases}{" "}
            db(s), {formatBytes(probe.totalSize)} on disk
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
