"use client";
import { useCallback, useState } from "react";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/lib/ai/settings";
import {
  MODEL_CATALOG,
  PROVIDER_LABELS,
  labelFor,
  type CatalogModel,
} from "@/lib/ai/model-catalog";

interface ActiveModel {
  provider: ProviderId | null;
  model: string;
}

export function ModelPicker({ onConfigure }: { onConfigure: () => void }) {
  const [active, setActive] = useState<ActiveModel>({ provider: null, model: "" });
  const [configured, setConfigured] = useState<Partial<Record<ProviderId, boolean>>>({});
  // Live model lists keyed by provider, lazily fetched from /api/ai/models.
  // Until a provider's list arrives we fall back to the static MODEL_CATALOG.
  const [models, setModels] = useState<Partial<Record<ProviderId, CatalogModel[]>>>({});
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const s = d.settings ?? {};
        const ap = (s.activeProvider ?? null) as ProviderId | null;
        setActive({ provider: ap, model: ap ? s.providers?.[ap]?.model ?? "" : "" });
        const cfg: Partial<Record<ProviderId, boolean>> = {};
        for (const p of Object.keys(MODEL_CATALOG) as ProviderId[]) {
          cfg[p] = Boolean(s.providers?.[p]?.apiKey);
        }
        setConfigured(cfg);
        // Pull the real model list for each configured provider so the menu
        // shows exactly what the key can use (no stale ids → no 404 at chat).
        for (const p of Object.keys(cfg) as ProviderId[]) {
          if (!cfg[p]) continue;
          fetch(`/api/ai/models?provider=${p}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((md) => {
              if (Array.isArray(md.models)) {
                setModels((prev) => ({ ...prev, [p]: md.models as CatalogModel[] }));
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const pick = useCallback(async (provider: ProviderId, model: string) => {
    setActive({ provider, model });
    setOpen(false);
    await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, activeProvider: provider }),
    }).catch(() => {});
  }, []);

  const label = active.provider ? labelFor(active.provider, active.model) : "Pick a model";

  return (
    <DropdownMenu open={open} onOpenChange={(v) => { setOpen(v); if (v) refresh(); }}>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 h-7 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors outline-none">
        <Sparkles className="size-3" />
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[240px] p-1">
        {(Object.keys(MODEL_CATALOG) as ProviderId[]).map((provider, i) => (
          <div key={provider}>
            {i > 0 ? <div className="my-1 h-px bg-border/60" aria-hidden /> : null}
            <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {PROVIDER_LABELS[provider]}
            </div>
            {configured[provider] ? (
              (models[provider] ?? MODEL_CATALOG[provider]).map((m) => {
                const isActive = active.provider === provider && active.model === m.id;
                return (
                  <DropdownMenuItem key={m.id} onClick={() => pick(provider, m.id)} className="gap-2">
                    <Check className={cn("size-3.5", isActive ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{m.label}</span>
                  </DropdownMenuItem>
                );
              })
            ) : (
              <DropdownMenuItem
                onClick={() => { setOpen(false); onConfigure(); }}
                className="text-muted-foreground italic"
              >
                <span className="flex-1">Add {PROVIDER_LABELS[provider]} API key…</span>
              </DropdownMenuItem>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
