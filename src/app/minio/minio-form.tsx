"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, MinioConfig } from "@/lib/connections/types";

interface Props { onSaved?: () => void; initial?: ConnectionRecord; }
interface Probe { buckets: number; endpoint: string; }

export function MinioForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as MinioConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "MinIO");
  const [endpoint, setEndpoint] = useState(init?.endpoint ?? "");
  const [useSSL, setUseSSL] = useState(init?.useSSL ?? false);
  const [accessKey, setAccessKey] = useState(init?.accessKey ?? "");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState(init?.region ?? "us-east-1");
  const [bucket, setBucket] = useState(init?.bucket ?? "");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      endpoint: endpoint.trim(), useSSL,
      accessKey: accessKey.trim(), region: region.trim() || "us-east-1",
      bucket: bucket.trim(),
    };
    if (secretKey) cfg.secretKey = secretKey;
    else if (!editing) cfg.secretKey = "";
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true); setError(null); setProbe(null);
    try {
      if (save && editing && initial) {
        const res = await fetch(`/api/connections/${initial.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, config: buildConfig() }),
        });
        const data = await res.json();
        if (res.ok) { toast.success("Connection updated"); onSaved?.(); }
        else { setError(data.error || "Update failed"); toast.error("Update failed", { description: data.error }); }
        return;
      }
      const res = await fetch("/api/minio/test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe);
        if (save) { toast.success("Connection saved"); onSaved?.(); }
        else toast.success("Connection works", { description: `${data.probe.buckets} bucket(s)` });
      } else { setError(data.error || "Connection failed"); toast.error("Connection failed", { description: data.error }); }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg); toast.error("Request failed", { description: msg });
    } finally { setTesting(false); }
  };

  const missingSecret = editing ? false : !secretKey;
  const testDisabled = testing || !endpoint.trim() || !accessKey.trim() || missingSecret;

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">{editing ? "Edit connection" : "New connection"}</h2>
        <p className="text-sm text-muted-foreground">
          Connect to a MinIO (or any S3-compatible) server. Enter the endpoint as
          <code className="text-[11px]"> host:port</code> or a full URL.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-name">Name</Label>
        <Input id="minio-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-endpoint">Endpoint</Label>
        <Input id="minio-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder="localhost:9000" />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="minio-ssl">Use SSL</Label>
          <p className="text-[11px] text-muted-foreground">Applied when the endpoint has no http(s):// scheme.</p>
        </div>
        <Switch id="minio-ssl" checked={useSSL} onCheckedChange={setUseSSL} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-access">Access Key</Label>
        <Input id="minio-access" value={accessKey} onChange={(e) => setAccessKey(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder="minioadmin" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-secret">Secret Key</Label>
        <Input id="minio-secret" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
          spellCheck={false} autoComplete="off"
          placeholder={editing ? "(unchanged — leave blank to keep)" : "secret key"} />
        <p className="text-[11px] text-muted-foreground">Stored encrypted-at-rest as a secret — never returned over the API.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-region">Region</Label>
        <Input id="minio-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-bucket">Default bucket (optional)</Label>
        <Input id="minio-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-bucket" />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => test(false)} disabled={testDisabled} variant="outline">
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Test
        </Button>
        <Button onClick={() => test(true)} disabled={testing}>
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {probe ? (
        <Alert><AlertTitle>Connected</AlertTitle>
          <AlertDescription>{probe.buckets} bucket(s) · {probe.endpoint}</AlertDescription></Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive"><AlertTitle>Could not connect</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription></Alert>
      ) : null}
    </Card>
  );
}
