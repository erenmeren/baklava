"use client";
import { useCallback, useEffect, useState } from "react";
import { Eye, SquarePen, Trash2, ShieldAlert, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ConnectionRecord } from "@/lib/connections/types";
import { isAiSupported } from "@/lib/ai/supported";

interface Policy {
  mode: "confirm" | "autonomous";
  read: boolean;
  write: boolean;
  destructive: boolean;
  confirmDestructive?: boolean;
  allowK8sSecretValues?: boolean;
}
const DEFAULT: Policy = { mode: "confirm", read: true, write: false, destructive: false };

export function PermissionSettings() {
  const [conns, setConns] = useState<ConnectionRecord[] | null>(null);
  const [policies, setPolicies] = useState<Record<string, Policy>>({});

  const loadPolicy = useCallback((id: string) => {
    fetch(`/api/ai/connections/${id}/policy`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { policy?: Policy }) => {
        if (d.policy) setPolicies((p) => ({ ...p, [id]: d.policy! }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) => {
        const list = (d.connections ?? []).filter((c) => isAiSupported(c.tech));
        setConns(list);
        list.forEach((c) => loadPolicy(c.id));
      })
      .catch(() => setConns([]));
  }, [loadPolicy]);

  const change = (id: string, patch: Partial<Policy>) => {
    const next = { ...(policies[id] ?? DEFAULT), ...patch };
    setPolicies((p) => ({ ...p, [id]: next })); // optimistic
    void fetch(`/api/ai/connections/${id}/policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
  };

  if (conns === null) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (conns.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
        <Lock className="mx-auto mb-3 size-5 text-muted-foreground/70" />
        <p className="text-sm font-medium text-foreground">No AI-ready connections yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
          Add a connection from the home screen. Once it exists, you can set what
          the assistant may do with it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {conns.length} connection{conns.length === 1 ? "" : "s"}
      </p>
      {conns.map((c) => (
        <ConnectionPolicy
          key={c.id}
          conn={c}
          policy={policies[c.id] ?? DEFAULT}
          onChange={(patch) => change(c.id, patch)}
        />
      ))}
    </div>
  );
}

const RUNGS = [
  {
    key: "read" as const,
    icon: Eye,
    label: "Read",
    desc: "Inspect, list, query — never changes anything.",
    tone: "neutral" as const,
  },
  {
    key: "write" as const,
    icon: SquarePen,
    label: "Write",
    desc: "Create and modify records, objects, config.",
    tone: "amber" as const,
  },
  {
    key: "destructive" as const,
    icon: Trash2,
    label: "Destructive",
    desc: "Delete, drop, truncate — irreversible.",
    tone: "red" as const,
  },
];

function ConnectionPolicy({
  conn,
  policy,
  onChange,
}: {
  conn: ConnectionRecord;
  policy: Policy;
  onChange: (patch: Partial<Policy>) => void;
}) {
  const autonomous = policy.mode === "autonomous";
  // needsApproval defaults destructive-confirm to ON unless explicitly false.
  const confirmDestructive = policy.confirmDestructive !== false;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/icons/${conn.tech}.svg`} alt="" className="size-4 opacity-80 dark:invert" />
        <span className="text-[13.5px] font-medium text-foreground">{conn.name}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {conn.tech}
        </span>
        <span className="ml-auto">
          <ModeToggle
            mode={policy.mode}
            onChange={(mode) => onChange({ mode })}
          />
        </span>
      </div>

      {/* capability ladder */}
      <div className="relative px-4 py-3.5">
        {/* vertical guide line through the rung icons */}
        <span
          className="pointer-events-none absolute left-[27px] top-7 bottom-7 w-px bg-border/70"
          aria-hidden
        />
        <div className="space-y-0.5">
          {RUNGS.map((r) => {
            const on = policy[r.key];
            return (
              <label
                key={r.key}
                className="relative flex cursor-pointer items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-foreground/[0.02]"
              >
                <span
                  className={cn(
                    "z-10 flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    on ? toneOn[r.tone] : "border-border bg-card text-muted-foreground/70",
                  )}
                >
                  <r.icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{r.label}</span>
                    {r.tone === "red" && on ? (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-destructive">
                        high risk
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {r.desc}
                  </span>
                </span>
                <Switch
                  checked={on}
                  onCheckedChange={(v: boolean) => onChange({ [r.key]: v })}
                />
              </label>
            );
          })}
        </div>

        {/* mode-dependent footer */}
        <div className="mt-2.5 border-t border-border/60 pt-2.5">
          {autonomous ? (
            <label className="flex cursor-pointer items-center gap-2.5 px-1.5">
              <ShieldAlert className="size-3.5 shrink-0 text-brand" />
              <span className="flex-1 text-[12.5px] text-foreground">
                Still ask before destructive actions
              </span>
              <Switch
                size="sm"
                checked={confirmDestructive}
                onCheckedChange={(v: boolean) => onChange({ confirmDestructive: v })}
              />
            </label>
          ) : (
            <p className="px-1.5 text-[12px] text-muted-foreground">
              In <span className="font-medium text-foreground">Ask-first</span> mode, every write or
              destructive action waits for your approval.
            </p>
          )}

          {conn.tech === "kubernetes" ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2.5 px-1.5">
              <Lock className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-[12.5px] text-foreground">
                Reveal Secret values
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  (redacted by default)
                </span>
              </span>
              <Switch
                size="sm"
                checked={Boolean(policy.allowK8sSecretValues)}
                onCheckedChange={(v: boolean) => onChange({ allowK8sSecretValues: v })}
              />
            </label>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const toneOn: Record<"neutral" | "amber" | "red", string> = {
  neutral: "border-foreground/15 bg-foreground/[0.06] text-foreground",
  amber: "border-brand/40 bg-brand/10 text-brand",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "confirm" | "autonomous";
  onChange: (mode: "confirm" | "autonomous") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
      {(
        [
          ["confirm", "Ask first"],
          ["autonomous", "Autonomous"],
        ] as const
      ).map(([value, label]) => {
        const active = mode === value;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={cn(
              "rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-all",
              active
                ? value === "autonomous"
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
