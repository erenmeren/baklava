"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";

interface Props {
  onSaved?: () => void;
}

interface Probe {
  context: string;
  cluster: string;
  apiServer: string;
  namespaceCount: number;
  nodeCount: number;
}

export function KubernetesForm({ onSaved }: Props) {
  const [name, setName] = useState("");
  const [kubeconfig, setKubeconfig] = useState("");
  const [context, setContext] = useState("");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const submit = async () => {
    if (!kubeconfig.trim()) {
      toast.error("Paste a kubeconfig");
      return;
    }
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      const res = await fetch("/api/kubernetes/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          save: true,
          config: {
            kubeconfig,
            context: context.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe as Probe);
        toast.success("Connected", {
          description: `${data.probe.context} · ${data.probe.nodeCount} node${data.probe.nodeCount === 1 ? "" : "s"}`,
        });
        onSaved?.();
      } else {
        setError(data.error || "Connection failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="k8s-name">Name (optional)</Label>
        <Input
          id="k8s-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="prod-cluster"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Defaults to the kubeconfig&rsquo;s current-context if blank.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="k8s-config">Kubeconfig YAML</Label>
          <span className="text-[11px] text-muted-foreground font-mono">
            paste contents of ~/.kube/config
          </span>
        </div>
        <Textarea
          id="k8s-config"
          value={kubeconfig}
          onChange={(e) => setKubeconfig(e.target.value)}
          rows={10}
          spellCheck={false}
          className="font-mono text-[11px]"
          placeholder={`apiVersion: v1
kind: Config
clusters:
- name: kind-baklava
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority-data: ...
contexts:
- name: kind-baklava
  context:
    cluster: kind-baklava
    user: kind-baklava
current-context: kind-baklava
users:
- name: kind-baklava
  user:
    client-certificate-data: ...
    client-key-data: ...`}
        />
        <p className="text-[11px] text-muted-foreground">
          Works with kind, minikube, EKS, GKE, AKS — anything <code>kubectl</code> understands. Stays in memory; never written to disk.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="k8s-context">Context override (optional)</Label>
        <Input
          id="k8s-context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="kind-baklava"
          spellCheck={false}
        />
      </div>

      {probe ? (
        <Alert>
          <AlertTitle className="text-sm">Connected to {probe.context}</AlertTitle>
          <AlertDescription className="text-xs font-mono">
            cluster: {probe.cluster} · {probe.nodeCount} node
            {probe.nodeCount === 1 ? "" : "s"} · {probe.namespaceCount} namespace
            {probe.namespaceCount === 1 ? "" : "s"}
            <br />
            {probe.apiServer}
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={testing || !kubeconfig.trim()}>
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <PlugZap className="size-3.5" />
          )}
          Test &amp; save
        </Button>
      </div>
    </Card>
  );
}
