"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type {
  ConnectionRecord,
  KubernetesConfig,
} from "@/lib/connections/types";
import { cn } from "@/lib/utils";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

type Source = "path" | "inline";

export function KubernetesForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as KubernetesConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "Local cluster");
  const [source, setSource] = useState<Source>(init?.source ?? "path");
  const [kubeconfigPath, setKubeconfigPath] = useState(
    init?.kubeconfigPath ?? "~/.kube/config",
  );
  const [kubeconfigYaml, setKubeconfigYaml] = useState("");
  const [context, setContext] = useState(init?.context ?? "");
  const [namespace, setNamespace] = useState(init?.namespace ?? "default");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    context: string;
    serverVersion: string;
    nodeCount: number;
  } | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      source,
      context: context.trim(),
      namespace: namespace.trim() || "default",
    };
    if (source === "path") {
      cfg.kubeconfigPath = kubeconfigPath.trim() || "~/.kube/config";
    } else {
      if (kubeconfigYaml) cfg.kubeconfigYaml = kubeconfigYaml;
      else if (!editing) cfg.kubeconfigYaml = "";
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
      const res = await fetch("/api/kubernetes/test", {
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
          toast.success("Cluster reachable", {
            description: `${data.probe.nodeCount} node(s) · ${data.probe.serverVersion}`,
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
          Point Baklava at a kubeconfig and pick a context. The workspace
          looks and feels like{" "}
          <span className="font-mono text-foreground/90">k9s</span>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="k8s-name">Name</Label>
        <Input
          id="k8s-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* Source selector — segmented control */}
      <div className="space-y-2">
        <Label>Kubeconfig source</Label>
        <div className="inline-flex p-0.5 rounded-md bg-muted/60 border border-border/60">
          {(["path", "inline"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={cn(
                "px-3 py-1 text-xs font-mono uppercase tracking-wider rounded transition-colors",
                source === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "path" ? "from path" : "paste YAML"}
            </button>
          ))}
        </div>
      </div>

      {source === "path" ? (
        <div className="space-y-2">
          <Label htmlFor="k8s-path">Kubeconfig path</Label>
          <Input
            id="k8s-path"
            value={kubeconfigPath}
            onChange={(e) => setKubeconfigPath(e.target.value)}
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Tilde-expanded server-side. Defaults to{" "}
            <span className="font-mono">~/.kube/config</span>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="k8s-yaml">Kubeconfig YAML</Label>
          <textarea
            id="k8s-yaml"
            value={kubeconfigYaml}
            onChange={(e) => setKubeconfigYaml(e.target.value)}
            placeholder={
              editing
                ? "(unchanged — leave blank to keep)"
                : "apiVersion: v1\nkind: Config\nclusters:\n  - name: ..."
            }
            spellCheck={false}
            rows={10}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-y"
          />
          <p className="text-[11px] text-muted-foreground">
            Stored as a secret in{" "}
            <span className="font-mono">~/.baklava/connections.json</span>{" "}
            (0600).
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="k8s-context">Context</Label>
          <Input
            id="k8s-context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            spellCheck={false}
            placeholder="(current-context)"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="k8s-ns">Default namespace</Label>
          <Input
            id="k8s-ns"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            spellCheck={false}
            placeholder="default"
            className="font-mono text-xs"
          />
        </div>
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
          <AlertDescription className="break-words">
            <span className="font-mono">{probe.context}</span> ·{" "}
            {probe.serverVersion} · {probe.nodeCount} node(s).
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
