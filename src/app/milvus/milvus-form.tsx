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
import type { MilvusConfig } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
}

export function MilvusForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Milvus");
  const [address, setAddress] = useState("localhost:19530");
  const [token, setToken] = useState("");
  const [ssl, setSsl] = useState(false);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    serverVersion: string;
    collectionCount: number;
  } | null>(null);

  const buildConfig = (): MilvusConfig => ({
    address: address.trim(),
    token: token.trim() || undefined,
    ssl,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/milvus/test", {
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
          toast.success("Milvus reachable", {
            description: `${data.probe.serverVersion} · ${data.probe.collectionCount} collection(s)`,
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
          Point Baklava at a Milvus gRPC endpoint. Use a token for Zilliz Cloud
          or auth-enabled clusters.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="milvus-name">Name</Label>
          <Input
            id="milvus-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="milvus-address">Address</Label>
          <Input
            id="milvus-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="host:19530"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="milvus-token">Token (optional)</Label>
        <Input
          id="milvus-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="username:password or Zilliz Cloud API key"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="milvus-ssl" className="cursor-pointer">
          Use SSL/TLS
        </Label>
        <Switch id="milvus-ssl" checked={ssl} onCheckedChange={setSsl} />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          onClick={() => test(false)}
          disabled={testing || !address.trim()}
          variant="outline"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button
          onClick={() => test(true)}
          disabled={testing || !address.trim()}
        >
          Test &amp; save
        </Button>
      </div>

      {probe ? (
        <Alert>
          <AlertTitle>Milvus reachable</AlertTitle>
          <AlertDescription>
            Server {probe.serverVersion} · {probe.collectionCount} collection
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
