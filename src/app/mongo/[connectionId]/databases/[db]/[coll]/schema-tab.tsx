"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

interface FieldType {
  type: string;
  count: number;
  sample: string;
}

interface Field {
  path: string;
  types: FieldType[];
  presence: number;
  totalSeen: number;
}

interface SchemaResult {
  sampleSize: number;
  fields: Field[];
}

const TYPE_COLOR: Record<string, string> = {
  string: "text-emerald-600 dark:text-emerald-400",
  int: "text-cyan-600 dark:text-cyan-400",
  double: "text-cyan-600 dark:text-cyan-400",
  long: "text-cyan-600 dark:text-cyan-400",
  decimal128: "text-cyan-600 dark:text-cyan-400",
  boolean: "text-amber-600 dark:text-amber-400",
  date: "text-fuchsia-600 dark:text-fuchsia-400",
  objectid: "text-rose-600 dark:text-rose-400",
  array: "text-violet-600 dark:text-violet-400",
  object: "text-muted-foreground",
  null: "text-zinc-500",
};

export function SchemaTab({ connectionId, dbName, collName }: Props) {
  const [sample, setSample] = useState(500);
  const [result, setResult] = useState<SchemaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/mongo/${connectionId}/databases/${encodeURIComponent(
    dbName,
  )}/collections/${encodeURIComponent(collName)}/schema`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${url}?sample=${sample}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `schema failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sample, url]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Sample size
          </label>
          <Input
            type="number"
            min={10}
            max={5000}
            value={sample}
            onChange={(e) =>
              setSample(Math.max(10, Math.min(5000, Number(e.target.value) || 500)))
            }
            className="w-32 font-mono"
          />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Resample
        </Button>
        <div className="ml-auto text-[11px] text-muted-foreground font-mono">
          {result ? (
            <>
              {result.fields.length} field(s) inferred from{" "}
              <span className="text-foreground tabular-nums">{result.sampleSize}</span> sampled docs
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {error}
        </div>
      ) : null}

      <div className="border border-border/60 rounded-md overflow-hidden">
        <table className="w-full font-mono text-xs">
          <thead className="bg-muted/30 border-b border-border/60">
            <tr>
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                field
              </th>
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground w-24">
                presence
              </th>
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                types
              </th>
              <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                sample value
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 className="size-4 animate-spin inline mr-2" />
                  sampling…
                </td>
              </tr>
            ) : result?.fields.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                  collection appears to be empty
                </td>
              </tr>
            ) : (
              result?.fields.map((f) => {
                const dominant = f.types.reduce((a, b) =>
                  a.count >= b.count ? a : b,
                );
                const indent = f.path.split(".").length - 1;
                const label = f.path.split(".").pop() ?? f.path;
                return (
                  <tr key={f.path} className="border-b border-border/40 last:border-0">
                    <td
                      className="px-3 py-1 align-top"
                      style={{ paddingLeft: `${12 + indent * 16}px` }}
                    >
                      <span className="text-foreground">{label}</span>
                      {indent > 0 ? (
                        <span className="text-muted-foreground/60 text-[10px] ml-2">
                          {f.path}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1 align-top">
                      <PresenceBar value={f.presence} />
                    </td>
                    <td className="px-3 py-1 align-top">
                      <div className="flex flex-wrap gap-1">
                        {f.types
                          .slice()
                          .sort((a, b) => b.count - a.count)
                          .map((t) => {
                            const pct = (t.count / f.totalSeen) * 100;
                            return (
                              <span
                                key={t.type}
                                className={cn(
                                  "uppercase tracking-[0.15em] text-[9px] px-1 py-0.5 rounded bg-muted",
                                  TYPE_COLOR[t.type] ?? "text-muted-foreground",
                                )}
                                title={`${t.count} of ${f.totalSeen} (${pct.toFixed(0)}%)`}
                              >
                                {t.type}
                                {f.types.length > 1 ? (
                                  <span className="ml-1 tabular-nums opacity-70">
                                    {pct.toFixed(0)}%
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}
                      </div>
                    </td>
                    <td className="px-3 py-1 align-top text-muted-foreground truncate max-w-[400px]">
                      {dominant.sample}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PresenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full",
            pct >= 95
              ? "bg-emerald-500"
              : pct >= 50
                ? "bg-amber-500"
                : "bg-rose-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">
        {pct}%
      </span>
    </div>
  );
}
