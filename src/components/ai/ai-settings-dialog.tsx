"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { ProviderId } from "@/lib/ai/settings";
import { MODEL_CATALOG, PROVIDER_LABELS, type CatalogModel } from "@/lib/ai/model-catalog";

export function AiSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODEL_CATALOG.anthropic[0].id);
  const [hasKey, setHasKey] = useState(false);
  const [agentName, setAgentName] = useState("");
  // Model options for the selected provider. Seeded from the static catalog,
  // then replaced with the provider's real list (what the saved key can use).
  const [models, setModels] = useState<CatalogModel[]>(MODEL_CATALOG.anthropic);

  // Fetch the live model list for a provider; leaves the static fallback in
  // place if there's no saved key or the call fails (the route handles both).
  const loadModels = (p: ProviderId) => {
    fetch(`/api/ai/models?provider=${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models) && d.models.length) setModels(d.models as CatalogModel[]);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAgentName(d.settings?.agentName ?? "");
        const active = d.settings?.activeProvider as ProviderId | null;
        if (active) {
          setProvider(active);
          setModel(d.settings.providers?.[active]?.model ?? MODEL_CATALOG[active][0].id);
          setHasKey(Boolean(d.settings.providers?.[active]?.apiKey));
          setModels(MODEL_CATALOG[active]);
          loadModels(active);
        }
      })
      .catch(() => {});
  }, [open]);

  const onProviderChange = (p: ProviderId) => {
    setProvider(p);
    if (!MODEL_CATALOG[p].some((m) => m.id === model)) setModel(MODEL_CATALOG[p][0].id);
    setApiKey("");
    setModels(MODEL_CATALOG[p]);
    loadModels(p);
  };

  const save = async () => {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, model, activeProvider: provider, agentName }),
    });
    if (res.ok) {
      toast.success("AI settings saved");
      onOpenChange(false);
    } else {
      toast.error("Could not save settings");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Assistant name</Label>
            <Input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Baklava Assistant"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as ProviderId)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? "(unchanged — leave blank to keep)" : "sk-…"}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
