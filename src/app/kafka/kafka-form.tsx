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
import type { KafkaConfig } from "@/lib/connections/types";

type SaslMechanism = "plain" | "scram-sha-256" | "scram-sha-512";

interface Props {
  onSaved?: () => void;
}

export function KafkaForm({ onSaved }: Props) {
  const [name, setName] = useState("Local Kafka");
  const [clientId, setClientId] = useState("baklava");
  const [brokers, setBrokers] = useState("localhost:9092");
  const [ssl, setSsl] = useState(false);
  const [useSasl, setUseSasl] = useState(false);
  const [saslMechanism, setSaslMechanism] = useState<SaslMechanism>("plain");
  const [saslUsername, setSaslUsername] = useState("");
  const [saslPassword, setSaslPassword] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokerCount, setBrokerCount] = useState<number | null>(null);

  const buildConfig = (): KafkaConfig => ({
    clientId,
    brokers: brokers
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean),
    ssl,
    sasl:
      useSasl && saslUsername
        ? {
            mechanism: saslMechanism,
            username: saslUsername,
            password: saslPassword,
          }
        : undefined,
  });

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setBrokerCount(null);
    try {
      const res = await fetch("/api/kafka/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setBrokerCount(data.probe.brokerCount);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Connection works", {
            description: `${data.probe.brokerCount} broker(s), ${data.probe.topics.length} topics`,
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
          Connect to one or more Kafka brokers. SASL is optional.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="kafka-name">Name</Label>
          <Input
            id="kafka-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kafka-client">Client ID</Label>
          <Input
            id="kafka-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="kafka-brokers">Brokers (comma separated)</Label>
        <Input
          id="kafka-brokers"
          value={brokers}
          onChange={(e) => setBrokers(e.target.value)}
          placeholder="host1:9092, host2:9092"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <Label htmlFor="kafka-ssl" className="cursor-pointer">
          Use SSL/TLS
        </Label>
        <Switch id="kafka-ssl" checked={ssl} onCheckedChange={setSsl} />
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="kafka-sasl" className="cursor-pointer">
            SASL authentication
          </Label>
          <Switch
            id="kafka-sasl"
            checked={useSasl}
            onCheckedChange={setUseSasl}
          />
        </div>
        {useSasl ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="sasl-mechanism">Mechanism</Label>
              <select
                id="sasl-mechanism"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                value={saslMechanism}
                onChange={(e) =>
                  setSaslMechanism(e.target.value as SaslMechanism)
                }
              >
                <option value="plain">PLAIN</option>
                <option value="scram-sha-256">SCRAM-SHA-256</option>
                <option value="scram-sha-512">SCRAM-SHA-512</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sasl-user">Username</Label>
                <Input
                  id="sasl-user"
                  value={saslUsername}
                  onChange={(e) => setSaslUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sasl-pass">Password</Label>
                <Input
                  id="sasl-pass"
                  type="password"
                  value={saslPassword}
                  onChange={(e) => setSaslPassword(e.target.value)}
                />
              </div>
            </div>
          </div>
        ) : null}
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

      {brokerCount !== null ? (
        <Alert>
          <AlertTitle>Cluster reachable</AlertTitle>
          <AlertDescription>{brokerCount} broker(s) online.</AlertDescription>
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
