"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Provider = "anthropic" | "openai" | "google";

export function AiSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const active = d.settings?.activeProvider as Provider | null;
        if (active) {
          setProvider(active);
          setModel(d.settings.providers?.[active]?.model ?? model);
          setHasKey(Boolean(d.settings.providers?.[active]?.apiKey));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, model, activeProvider: provider }),
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
            <Label>Provider</Label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="google">Google (Gemini)</option>
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
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
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
