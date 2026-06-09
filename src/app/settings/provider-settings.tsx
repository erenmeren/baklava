"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Check, Loader2, Bot } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/lib/ai/settings";
import { MODEL_CATALOG, PROVIDER_LABELS, type CatalogModel } from "@/lib/ai/model-catalog";

const PROVIDERS = Object.keys(PROVIDER_LABELS) as ProviderId[];

interface PublicProvider {
  apiKey?: string; // redacted bullets when a real key is stored
  model?: string;
}
interface PublicSettings {
  activeProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, PublicProvider>>;
  stepCap: number;
  agentName: string;
}

export function ProviderSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [editing, setEditing] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<CatalogModel[]>(MODEL_CATALOG.anthropic);
  const [modelSource, setModelSource] = useState<"live" | "fallback">("fallback");
  const [savingKey, setSavingKey] = useState(false);

  const [agentName, setAgentName] = useState("");
  const [stepCap, setStepCap] = useState(12);
  const [savingAssistant, setSavingAssistant] = useState(false);

  const hasKey = Boolean(settings?.providers[editing]?.apiKey);
  const activeProvider = settings?.activeProvider ?? null;

  const loadModels = useCallback((p: ProviderId) => {
    setModels(MODEL_CATALOG[p]);
    fetch(`/api/ai/models?provider=${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { models?: CatalogModel[]; source?: "live" | "fallback" }) => {
        if (Array.isArray(d.models) && d.models.length) setModels(d.models);
        setModelSource(d.source === "live" ? "live" : "fallback");
      })
      .catch(() => setModelSource("fallback"));
  }, []);

  const refresh = useCallback(() => {
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { settings?: PublicSettings }) => {
        const s = d.settings;
        if (!s) return;
        setSettings(s);
        setAgentName(s.agentName ?? "");
        setStepCap(s.stepCap ?? 12);
        const start = (s.activeProvider ?? "anthropic") as ProviderId;
        setEditing(start);
        setModel(s.providers[start]?.model ?? MODEL_CATALOG[start][0].id);
        loadModels(start);
      })
      .catch(() => {});
  }, [loadModels]);

  useEffect(() => { refresh(); }, [refresh]);

  const selectProvider = (p: ProviderId) => {
    setEditing(p);
    setApiKey("");
    setModel(settings?.providers[p]?.model ?? MODEL_CATALOG[p][0].id);
    loadModels(p);
  };

  const saveKey = async () => {
    // Don't make an unconfigured provider active by mistake.
    const willHaveKey = hasKey || apiKey.trim().length > 0;
    if (!willHaveKey) {
      toast.error("Enter an API key first");
      return;
    }
    setSavingKey(true);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: editing, apiKey, model, activeProvider: editing }),
      });
      if (!res.ok) throw new Error();
      setApiKey("");
      toast.success(`${PROVIDER_LABELS[editing]} saved and set active`);
      refresh();
    } catch {
      toast.error("Couldn't save the provider");
    } finally {
      setSavingKey(false);
    }
  };

  const saveAssistant = async () => {
    setSavingAssistant(true);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentName, stepCap }),
      });
      if (!res.ok) throw new Error();
      toast.success("Assistant settings saved");
      refresh();
    } catch {
      toast.error("Couldn't save assistant settings");
    } finally {
      setSavingAssistant(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Provider tiles */}
      <div className="space-y-2.5">
        <Label className="text-muted-foreground">Model provider</Label>
        <div className="grid grid-cols-3 gap-2.5">
          {PROVIDERS.map((p) => {
            const configured = Boolean(settings?.providers[p]?.apiKey);
            const active = activeProvider === p;
            const selected = editing === p;
            return (
              <button
                key={p}
                onClick={() => selectProvider(p)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border bg-card px-3.5 py-3 text-left text-card-foreground transition-colors",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md border",
                    configured
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  <KeyRound className="size-3.5" />
                </span>
                <span className="text-sm font-medium leading-tight">
                  {PROVIDER_LABELS[p].split(" (")[0]}
                </span>
                {active ? (
                  <Badge variant="default" className="gap-1">
                    <span className="size-1.5 rounded-full bg-current" /> Active
                  </Badge>
                ) : configured ? (
                  <Badge variant="secondary">Key set</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Not set
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Key + model editor */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{PROVIDER_LABELS[editing]}</CardTitle>
          <CardDescription>
            {modelSource === "live" ? "Live model list" : "Default model list"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API key</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "(unchanged — leave blank to keep)" : "sk-…"}
                className="pl-8 font-mono"
                autoComplete="off"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Stored on the server, never returned to the browser.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={model} onValueChange={(v) => setModel(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {activeProvider === editing && hasKey ? (
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" /> Active
              </Badge>
            ) : null}
            <Button onClick={saveKey} disabled={savingKey} className="min-w-[8.5rem]">
              {savingKey ? <Loader2 className="size-4 animate-spin" /> : "Save & activate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Global assistant settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" /> Assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              maxLength={60}
              placeholder="Baklava Assistant"
            />
            <p className="text-xs text-muted-foreground">
              What the assistant calls itself.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Step limit</Label>
              <span className="text-sm font-medium tabular-nums">{stepCap}</span>
            </div>
            <Slider
              min={1}
              max={50}
              value={[stepCap]}
              onValueChange={(v) =>
                setStepCap(Array.isArray(v) ? v[0] : v)
              }
            />
            <p className="text-xs text-muted-foreground">
              Max tool calls the assistant may chain in one turn.
            </p>
          </div>

          <div className="flex justify-end pt-1">
            <Button variant="outline" onClick={saveAssistant} disabled={savingAssistant}>
              {savingAssistant ? <Loader2 className="size-4 animate-spin" /> : "Save assistant"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
