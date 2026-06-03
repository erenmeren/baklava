"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, PlugZap, Save } from "lucide-react";
import { useBlobConnectionForm } from "@/components/blob/use-blob-connection-form";
import type { ConnectionRecord, S3Config } from "@/lib/connections/types";

interface Props { onSaved?: () => void; initial?: ConnectionRecord; }
interface Probe { buckets: number; endpoint: string; }

export function S3Form({ onSaved, initial }: Props) {
  const init = initial?.config as S3Config | undefined;

  const [region, setRegion] = useState(init?.region ?? "us-east-1");
  const [accessKeyId, setAccessKeyId] = useState(init?.accessKeyId ?? "");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [bucket, setBucket] = useState(init?.bucket ?? "");

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      region: region.trim() || "us-east-1",
      accessKeyId: accessKeyId.trim(),
      bucket: bucket.trim(),
    };
    if (secretAccessKey) cfg.secretAccessKey = secretAccessKey;
    else if (!editing) cfg.secretAccessKey = "";
    // sessionToken is optional; only send when provided (omit-on-blank keeps stored value when editing)
    if (sessionToken && !clearToken) cfg.sessionToken = sessionToken;
    return cfg;
  };

  const { editing, name, setName, testing, error, probe, test } =
    useBlobConnectionForm<Probe>({
      tech: "s3",
      initial,
      defaultName: "Amazon S3",
      buildConfig,
      onSaved,
      okDescription: (p) => `${p.buckets} bucket(s)`,
      patchExtra: () => (clearToken ? { unset: ["sessionToken"] } : {}),
    });

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
          spellCheck={false} autoComplete="off" disabled={clearToken}
          placeholder={editing && init?.sessionToken ? "(unchanged — leave blank to keep)" : "for temporary STS credentials"} />
        {editing && Boolean(init?.sessionToken) ? (
          <div className="flex items-center justify-between pt-1">
            <div className="space-y-0.5">
              <Label htmlFor="s3-clear-token">Remove the saved session token</Label>
              <p className="text-[11px] text-muted-foreground">Clear the stored STS token (e.g. when it has expired).</p>
            </div>
            <Switch id="s3-clear-token" checked={clearToken} onCheckedChange={setClearToken} />
          </div>
        ) : null}
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
