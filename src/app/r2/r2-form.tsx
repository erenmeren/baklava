"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, R2Config } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

interface Probe {
  buckets: number;
  endpoint: string;
}

export function R2Form({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as R2Config | undefined;

  const [name, setName] = useState(initial?.name ?? "Cloudflare R2");
  const [accountId, setAccountId] = useState(init?.accountId ?? "");
  const [accessKeyId, setAccessKeyId] = useState(init?.accessKeyId ?? "");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState(init?.bucket ?? "");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      accountId: accountId.trim(),
      accessKeyId: accessKeyId.trim(),
      bucket: bucket.trim(),
    };
    if (secretAccessKey) cfg.secretAccessKey = secretAccessKey;
    else if (!editing) cfg.secretAccessKey = "";
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
      const res = await fetch("/api/r2/test", {
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
            description: `${data.probe.buckets} bucket(s)`,
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

  const missingSecret = editing ? false : !secretAccessKey;
  const testDisabled =
    testing || !accountId.trim() || !accessKeyId.trim() || missingSecret;

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect to a Cloudflare R2 bucket with an S3 API token. Find your
          Account ID and create API tokens in the Cloudflare dashboard under
          R2.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-name">Name</Label>
        <Input id="r2-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-account">Account ID</Label>
        <Input
          id="r2-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="8df1045d97ff80861a1278eb2c88a17e"
        />
        <p className="text-[11px] text-muted-foreground">
          Endpoint:{" "}
          <code className="text-[11px]">
            https://{accountId || "<account-id>"}.r2.cloudflarestorage.com
          </code>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-akid">Access Key ID</Label>
        <Input
          id="r2-akid"
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-secret">Secret Access Key</Label>
        <Input
          id="r2-secret"
          type="password"
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            editing ? "(unchanged — leave blank to keep)" : "secret access key"
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Stored encrypted-at-rest as a secret — never returned over the API.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-bucket">Default bucket (optional)</Label>
        <Input
          id="r2-bucket"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          placeholder="my-bucket"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => test(false)} disabled={testDisabled} variant="outline">
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
            {probe.buckets} bucket(s) · {probe.endpoint}
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
