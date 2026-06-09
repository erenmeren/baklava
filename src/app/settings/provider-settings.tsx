"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Check, Loader2, Bot, Gauge } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-8">
      {/* ── Provider tiles ─────────────────────────────────────────── */}
      <section>
        <SectionLabel>Model provider</SectionLabel>
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
                  "group relative flex flex-col items-start gap-2 rounded-xl border px-3.5 py-3 text-left transition-all",
                  selected
                    ? "border-brand/70 bg-brand/[0.06] shadow-[0_1px_0_0_var(--color-brand)_inset]"
                    : "border-border bg-card hover:border-border hover:bg-foreground/[0.02]",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-lg border transition-colors",
                    configured
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-border bg-muted/60 text-muted-foreground",
                  )}
                >
                  <KeyRound className="size-3.5" />
                </span>
                <span className="text-[13px] font-medium leading-tight text-foreground">
                  {PROVIDER_LABELS[p].split(" (")[0]}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  {active ? (
                    <span className="text-brand">● active</span>
                  ) : configured ? (
                    <span className="text-muted-foreground">key set</span>
                  ) : (
                    <span className="text-muted-foreground/60">not set</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Key + model editor ─────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {PROVIDER_LABELS[editing]}
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {modelSource === "live" ? "live model list" : "default model list"}
          </span>
        </div>

        <div className="space-y-4">
          <Field label="API key" hint="Stored on the server, never returned to the browser.">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "•••••••••••••  saved — leave blank to keep" : "sk-…"}
                className="pl-8 font-mono"
                autoComplete="off"
              />
            </div>
          </Field>

          <Field label="Model">
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
          </Field>

          <div className="flex items-center justify-end gap-3 pt-1">
            {activeProvider === editing && hasKey ? (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-brand">
                <Check className="size-3" /> active
              </span>
            ) : null}
            <Button onClick={saveKey} disabled={savingKey} className="min-w-[8.5rem]">
              {savingKey ? <Loader2 className="size-4 animate-spin" /> : "Save & activate"}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Global assistant settings ──────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bot className="size-4 text-brand" /> Assistant
        </h2>
        <div className="space-y-4">
          <Field label="Name" hint="What the assistant calls itself.">
            <Input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              maxLength={60}
              placeholder="Baklava Assistant"
            />
          </Field>

          <Field label="Step limit" hint="Max tool calls the assistant may chain in one turn.">
            <div className="flex items-center gap-3">
              <Gauge className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="range"
                min={1}
                max={50}
                value={stepCap}
                onChange={(e) => setStepCap(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-input accent-[var(--color-brand)]"
              />
              <span className="w-8 text-right font-mono text-sm tabular-nums text-foreground">
                {stepCap}
              </span>
            </div>
          </Field>

          <div className="flex justify-end pt-1">
            <Button variant="outline" onClick={saveAssistant} disabled={savingAssistant}>
              {savingAssistant ? <Loader2 className="size-4 animate-spin" /> : "Save assistant"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-[13px]">{label}</Label>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
