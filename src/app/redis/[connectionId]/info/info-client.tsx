"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Client {
  id: string;
  addr: string;
  name: string;
  age: number;
  idle: number;
  db: number;
  cmd: string;
  flags: string;
}

interface Slow {
  id: number;
  timestamp: number;
  duration: number;
  command: string[];
  client?: string;
  clientName?: string;
}

interface Props {
  sections: Record<string, Record<string, string>>;
  clients: Client[];
  slowlog: Slow[];
  errors: string[];
}

type Tab = "info" | "clients" | "slowlog";

export function InfoClient({ sections, clients, slowlog, errors }: Props) {
  const [tab, setTab] = useState<Tab>("info");
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "info", label: "INFO", count: Object.keys(sections).length },
    { id: "clients", label: "Clients", count: clients.length },
    { id: "slowlog", label: "Slowlog", count: slowlog.length },
  ];

  return (
    <div className="space-y-4">
      {errors.length > 0 ? (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2 space-y-1">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1 border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-rose-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground/70">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "info" ? <InfoSections sections={sections} /> : null}
      {tab === "clients" ? <ClientsTable clients={clients} /> : null}
      {tab === "slowlog" ? <SlowlogTable entries={slowlog} /> : null}
    </div>
  );
}

function InfoSections({
  sections,
}: {
  sections: Record<string, Record<string, string>>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(sections).map(([name, kv]) => (
        <div
          key={name}
          className="border border-border/60 rounded-md overflow-hidden"
        >
          <div className="px-3 py-1.5 border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {name}
          </div>
          <table className="w-full font-mono text-[11.5px]">
            <tbody>
              {Object.entries(kv).map(([k, v]) => (
                <tr
                  key={k}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="px-3 py-1 text-muted-foreground align-top w-1/2 break-all">
                    {k}
                  </td>
                  <td className="px-3 py-1 align-top break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ClientsTable({ clients }: { clients: Client[] }) {
  if (clients.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground text-xs">
        no clients connected
      </div>
    );
  }
  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      <table className="w-full font-mono text-xs">
        <thead className="bg-muted/30 border-b border-border/60">
          <tr>
            {["id", "addr", "name", "db", "age", "idle", "cmd", "flags"].map((h) => (
              <th
                key={h}
                className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-1 tabular-nums">{c.id}</td>
              <td className="px-3 py-1 text-muted-foreground">{c.addr}</td>
              <td className="px-3 py-1">{c.name || "—"}</td>
              <td className="px-3 py-1 tabular-nums">{c.db}</td>
              <td className="px-3 py-1 tabular-nums">{c.age}s</td>
              <td className="px-3 py-1 tabular-nums">{c.idle}s</td>
              <td className="px-3 py-1 text-emerald-600 dark:text-emerald-400">
                {c.cmd}
              </td>
              <td className="px-3 py-1 text-muted-foreground">{c.flags}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlowlogTable({ entries }: { entries: Slow[] }) {
  if (entries.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground text-xs">
        slowlog is empty
      </div>
    );
  }
  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      <table className="w-full font-mono text-xs">
        <thead className="bg-muted/30 border-b border-border/60">
          <tr>
            {["#", "when", "duration", "client", "command"].map((h) => (
              <th
                key={h}
                className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-1 tabular-nums">{e.id}</td>
              <td className="px-3 py-1 tabular-nums text-muted-foreground">
                {new Date(e.timestamp * 1000).toISOString().slice(0, 19)}
              </td>
              <td className="px-3 py-1 tabular-nums">
                <span
                  className={
                    e.duration > 100_000
                      ? "text-red-600 dark:text-red-400"
                      : e.duration > 10_000
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                  }
                >
                  {(e.duration / 1000).toFixed(2)}ms
                </span>
              </td>
              <td className="px-3 py-1 text-muted-foreground">
                {e.client ?? "—"}
              </td>
              <td className="px-3 py-1">
                <span className="text-emerald-600 dark:text-emerald-400">
                  {e.command[0]}
                </span>
                {e.command.length > 1
                  ? " " + e.command.slice(1).join(" ")
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
