"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Skull } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Op {
  opid: string;
  type: string;
  op: string;
  ns: string;
  secs_running: number;
  microsecs_running: number;
  client?: string;
  desc?: string;
  command?: string;
  waitingForLock?: boolean;
}

interface Props {
  connectionId: string;
}

export function CurrentOpClient({ connectionId }: Props) {
  const [ops, setOps] = useState<Op[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [includeIdle, setIncludeIdle] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/mongo/${connectionId}/current-op?includeIdle=${includeIdle}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOps(data.ops);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, includeIdle]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  async function kill(opid: string) {
    if (!confirm(`Kill op ${opid}?`)) return;
    try {
      const res = await fetch(
        `/api/mongo/${connectionId}/current-op?opid=${encodeURIComponent(opid)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Op ${opid} killed`);
      load();
    } catch (err) {
      toast.error("killOp failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const selectedOp = ops.find((o) => o.opid === selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={load} variant="outline" disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id="op-idle"
            checked={includeIdle}
            onCheckedChange={setIncludeIdle}
          />
          <Label htmlFor="op-idle" className="text-sm cursor-pointer">
            include idle
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="op-auto"
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
          />
          <Label htmlFor="op-auto" className="text-sm cursor-pointer">
            auto-refresh (2s)
          </Label>
        </div>
        <div className="ml-auto text-[11px] text-muted-foreground font-mono">
          <span className="text-foreground tabular-nums">{ops.length}</span> active
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_minmax(0,1.2fr)] gap-4 min-h-[400px]">
        <div className="border border-border/60 rounded-md overflow-hidden">
          <table className="w-full font-mono text-xs">
            <thead className="bg-muted/30 border-b border-border/60">
              <tr>
                {["opid", "op", "ns", "run", "lock", ""].map((h) => (
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
              {ops.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    no active operations
                  </td>
                </tr>
              ) : (
                ops.map((o) => (
                  <tr
                    key={o.opid}
                    onClick={() => setSelected(o.opid)}
                    className={cn(
                      "border-b border-border/40 last:border-0 cursor-pointer",
                      selected === o.opid
                        ? "bg-emerald-500/8"
                        : "hover:bg-foreground/[0.03]",
                    )}
                  >
                    <td className="px-3 py-1.5 tabular-nums">{o.opid}</td>
                    <td className="px-3 py-1.5 text-emerald-700 dark:text-emerald-400">
                      {o.op}
                    </td>
                    <td className="px-3 py-1.5 truncate max-w-[200px]" title={o.ns}>
                      {o.ns}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 tabular-nums",
                        o.secs_running > 5
                          ? "text-rose-600 dark:text-rose-400"
                          : o.secs_running > 1
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {o.secs_running}s
                    </td>
                    <td className="px-3 py-1.5">
                      {o.waitingForLock ? (
                        <span className="uppercase tracking-[0.15em] text-[9px] px-1 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300">
                          waiting
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          kill(o.opid);
                        }}
                        className="text-muted-foreground hover:text-rose-500"
                        title="killOp"
                      >
                        <Skull className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border border-border/60 rounded-md overflow-hidden bg-zinc-950">
          <div className="px-3 py-1.5 border-b border-border/60 bg-zinc-900/60 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            op detail
          </div>
          <pre className="p-4 font-mono text-[11.5px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words overflow-auto max-h-[500px]">
            {selectedOp ? (
              <>
                <span className="text-zinc-500">opid:</span> {selectedOp.opid}
                {"\n"}
                <span className="text-zinc-500">type:</span> {selectedOp.type}
                {"\n"}
                <span className="text-zinc-500">desc:</span> {selectedOp.desc ?? "—"}
                {"\n"}
                <span className="text-zinc-500">client:</span>{" "}
                {selectedOp.client ?? "—"}
                {"\n"}
                <span className="text-zinc-500">runtime:</span>{" "}
                {selectedOp.microsecs_running.toLocaleString()}µs
                {"\n\n"}
                <span className="text-zinc-500">command:</span>
                {"\n"}
                {selectedOp.command
                  ? (() => {
                      try {
                        return JSON.stringify(
                          JSON.parse(selectedOp.command),
                          null,
                          2,
                        );
                      } catch {
                        return selectedOp.command;
                      }
                    })()
                  : "(none)"}
              </>
            ) : (
              <span className="text-zinc-500 italic">select an op</span>
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
