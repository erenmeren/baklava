"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";

export interface PolicyView {
  mode: "confirm" | "autonomous";
  read: boolean;
  write: boolean;
  destructive: boolean;
  allowK8sSecretValues?: boolean;
}

export function WorkingSet({
  connections,
  policies,
  onRemove,
  onPolicyChange,
}: {
  connections: ConnectionRecord[];
  policies: Record<string, PolicyView>;
  onRemove: (id: string) => void;
  onPolicyChange: (id: string, policy: PolicyView) => void;
}) {
  if (connections.length === 0) {
    return <div className="text-xs text-muted-foreground px-1 py-1.5">No connections yet — type <kbd className="font-mono">/</kbd> to add one.</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {connections.map((c) => {
        const p = policies[c.id] ?? { mode: "confirm", read: true, write: false, destructive: false };
        const modeLabel = p.destructive ? "rwd" : p.write ? "rw" : "ro";
        return (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/icons/${c.tech}.svg`} alt="" className="size-3 dark:invert opacity-80" />
            <span className="font-medium">{c.name}</span>
            <PolicyChip id={c.id} tech={c.tech} policy={p} label={modeLabel} onChange={onPolicyChange} />
            <button onClick={() => onRemove(c.id)} title="Remove" className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function PolicyChip({
  id, tech, policy, label, onChange,
}: { id: string; tech: TechId; policy: PolicyView; label: string; onChange: (id: string, p: PolicyView) => void }) {
  const [open, setOpen] = useState(false);
  const row = (key: "read" | "write" | "destructive", text: string) => (
    <label className="flex items-center justify-between gap-3 py-1 text-xs">
      <span>{text}</span>
      <Switch checked={policy[key]} onCheckedChange={(v: boolean) => onChange(id, { ...policy, [key]: v })} />
    </label>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="font-mono text-[10px] uppercase rounded px-1 text-muted-foreground hover:text-foreground" title="Edit permissions">
        ·{label}
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Permissions</div>
        {row("read", "Read")}
        {row("write", "Write")}
        {row("destructive", "Destructive")}
        {tech === "kubernetes" ? (
          <>
            <div className="my-1 h-px bg-border/60" />
            <label className="flex items-center justify-between gap-3 py-1 text-xs">
              <span>Reveal secret values</span>
              <Switch checked={Boolean(policy.allowK8sSecretValues)} onCheckedChange={(v: boolean) => onChange(id, { ...policy, allowK8sSecretValues: v })} />
            </label>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
