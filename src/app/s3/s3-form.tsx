"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, S3Config } from "@/lib/connections/types";

interface Props { onSaved?: () => void; initial?: ConnectionRecord; }
interface Probe { buckets: number; endpoint: string; }

export function S3Form({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as S3Config | undefined;

  const [name, setName] = useState(initial?.name ?? "Amazon S3");
  const [region, setRegion] = useState(init?.region ?? "us-east-1");
  const [accessKeyId, setAccessKeyId] = useState(init?.accessKeyId ?? "");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [bucket, setBucket] = useState(init?.bucket ?? "");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      region: region.trim() || "us-east-1",
      accessKeyId: accessKeyId.trim(),
      bucket: bucket.trim(),
    };
    if (secretAccessKey) cfg.secretAccessKey = secretAccessKey;
    else if (!editing) cfg.secretAccessKey = "";
    // sessionToken is optional; only send when provided (omit-on-blank keeps stored value when editing)
    if (sessionToken) cfg.sessionToken = sessionToken;
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
      const res = await fetch("/api/s3/test", {
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

  const missingSecret = editing ? false : !secretAccessKey;
  const testDisabled = testing || !region.trim() || !accessKeyId.trim() || missingSecret;

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">{editing ? "Edit connection" : "New connection"}</h2>
        <p className="text-sm text-muted-foreground">
          Connect to Amazon S3 with an IAM access key. The endpoint is derived from
          the region.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="s3-name">Name</Label>
        <Input id="s3-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="s3-region">Region</Label>
        <Input id="s3-region" value={region} onChange={(e) => setRegion(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder="us-east-1" />
        <p className="text-[11px] text-muted-foreground">
          Endpoint: <code className="text-[11px]">https://s3.{region || "<region>"}.amazonaws.com</code>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="s3-akid">Access Key ID</Label>
        <Input id="s3-akid" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder="AKIA…" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="s3-secret">Secret Access Key</Label>
        <Input id="s3-secret" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)}
          spellCheck={false} autoComplete="off"
          placeholder={editing ? "(unchanged — leave blank to keep)" : "secret access key"} />
        <p className="text-[11px] text-muted-foreground">Stored encrypted-at-rest as a secret — never returned over the API.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="s3-token">Session Token (optional)</Label>
        <Input id="s3-token" type="password" value={sessionToken} onChange={(e) => setSessionToken(e.target.value)}
          spellCheck={false} autoComplete="off"
          placeholder={editing && init?.sessionToken ? "(unchanged — leave blank to keep)" : "for temporary STS credentials"} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="s3-bucket">Default bucket (optional)</Label>
        <Input id="s3-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-bucket" />
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
