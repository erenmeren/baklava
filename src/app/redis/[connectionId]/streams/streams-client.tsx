"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";

interface Props {
  connectionId: string;
  isCluster: boolean;
}

interface Entry {
  id: string;
  fields: { field: string; value: string }[];
}

interface StreamDetail {
  type: string;
  value: { kind: "stream"; entries: Entry[]; length: number };
}

export function StreamsClient({ connectionId, isCluster }: Props) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [db, setDb] = useState(0);

  async function load(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!isCluster) params.set("db", String(db));
      const res = await fetch(
        `/api/redis/${connectionId}/key/${encodeURIComponent(key)}?${params.toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `read failed (${res.status})`);
      if (data.type !== "stream") {
        throw new Error(`"${key}" is type ${data.type}, not a stream`);
      }
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={load} className="flex items-end gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Stream key
          </label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70" />
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="pl-8 font-mono"
              placeholder="events:orders"
              spellCheck={false}
            />
          </div>
        </div>
        {!isCluster ? (
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              DB
            </label>
            <Input
              type="number"
              min={0}
              max={15}
              value={db}
              onChange={(e) => setDb(Number(e.target.value) || 0)}
              className="w-20 font-mono"
            />
          </div>
        ) : null}
        <Button type="submit" disabled={loading || !key.trim()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Load
        </Button>
      </form>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {error}
        </div>
      ) : null}

      {detail ? (
        <div className="space-y-3">
          <div className="text-[11px] text-muted-foreground font-mono">
            length{" "}
            <span className="text-foreground tabular-nums">
              {detail.value.length}
            </span>
            {" · showing latest "}
            <span className="text-foreground tabular-nums">
              {detail.value.entries.length}
            </span>
          </div>
          <div className="space-y-2">
            {detail.value.entries.map((e) => (
              <div
                key={e.id}
                className="border border-border/60 rounded-md font-mono text-xs overflow-hidden"
              >
                <div className="px-3 py-1.5 border-b border-border/60 bg-muted/30 flex items-center justify-between">
                  <span className="text-rose-600 dark:text-rose-400">
                    {e.id}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {e.fields.length} field(s)
                  </span>
                </div>
                <table className="w-full">
                  <tbody>
                    {e.fields.map((f, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="px-3 py-1 text-muted-foreground align-top w-40">
                          {f.field}
                        </td>
                        <td className="px-3 py-1 align-top whitespace-pre-wrap break-words">
                          {f.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 py-12 text-center text-muted-foreground text-xs">
          enter a stream key to browse
        </div>
      )}
    </div>
  );
}
