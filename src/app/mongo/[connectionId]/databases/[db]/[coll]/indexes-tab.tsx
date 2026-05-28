"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

interface Index {
  name: string;
  keys: string;
  unique: boolean;
  sparse: boolean;
  ttl?: number;
  partial: boolean;
  size?: number;
}

interface Usage {
  name: string;
  ops: number;
  since: string;
}

function formatSize(b?: number) {
  if (!b) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 ** 2).toFixed(1)}MB`;
}

export function IndexesTab({ connectionId, dbName, collName }: Props) {
  const url = `/api/mongo/${connectionId}/databases/${encodeURIComponent(
    dbName,
  )}/collections/${encodeURIComponent(collName)}/indexes`;
  const [indexes, setIndexes] = useState<Index[] | null>(null);
  const [usage, setUsage] = useState<Record<string, Usage>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [idxRes, usageRes] = await Promise.all([
        fetch(url).then((r) => r.json()),
        fetch(`${url.replace(/\/indexes$/, "/index-stats")}`)
          .then((r) => r.json())
          .catch(() => ({ usage: [] })),
      ]);
      if (idxRes.error) throw new Error(idxRes.error);
      setIndexes(idxRes.indexes);
      const usageMap: Record<string, Usage> = {};
      for (const u of (usageRes.usage ?? []) as Usage[]) {
        usageMap[u.name] = u;
      }
      setUsage(usageMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  async function drop(name: string) {
    if (name === "_id_") {
      toast.error("Cannot drop the _id index");
      return;
    }
    if (!confirm(`Drop index "${name}"?`)) return;
    try {
      const res = await fetch(`${url}?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Index dropped");
      load();
    } catch (err) {
      toast.error("Drop failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground font-mono">
          {indexes ? `${indexes.length} index(es)` : "loading…"}
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Create index
        </Button>
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
              {["name", "keys", "flags", "ttl", "size", "ops", ""].map((h) => (
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
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 className="size-4 animate-spin inline mr-2" />
                  loading
                </td>
              </tr>
            ) : indexes?.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  no indexes
                </td>
              </tr>
            ) : (
              indexes?.map((idx) => (
                <tr key={idx.name} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1.5">{idx.name}</td>
                  <td className="px-3 py-1.5 text-emerald-700 dark:text-emerald-400 whitespace-pre-wrap break-all">
                    {idx.keys}
                  </td>
                  <td className="px-3 py-1.5 space-x-1">
                    {idx.unique ? (
                      <Badge color="bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300">
                        unique
                      </Badge>
                    ) : null}
                    {idx.sparse ? (
                      <Badge color="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        sparse
                      </Badge>
                    ) : null}
                    {idx.partial ? (
                      <Badge color="bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                        partial
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {idx.ttl !== undefined ? `${idx.ttl}s` : "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {formatSize(idx.size)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {usage[idx.name] !== undefined ? (
                      <span
                        className={cn(
                          usage[idx.name].ops > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-500",
                        )}
                        title={`since ${usage[idx.name].since}`}
                      >
                        {usage[idx.name].ops.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => drop(idx.name)}
                      disabled={idx.name === "_id_"}
                      className={cn(
                        "text-muted-foreground hover:text-red-500",
                        idx.name === "_id_" && "cursor-not-allowed opacity-30",
                      )}
                      title={idx.name === "_id_" ? "_id index can't be dropped" : "drop"}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating ? (
        <CreateIndexModal
          url={url}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "uppercase tracking-[0.18em] text-[9px] px-1.5 py-0.5 rounded",
        color,
      )}
    >
      {children}
    </span>
  );
}

function CreateIndexModal({
  url,
  onClose,
  onCreated,
}: {
  url: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [keys, setKeys] = useState('{"createdAt": -1}');
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [ttl, setTtl] = useState("");
  const [partial, setPartial] = useState("");
  const [saving, setSaving] = useState(false);

  let validKeys = true;
  try {
    JSON.parse(keys);
  } catch {
    validKeys = false;
  }

  async function create() {
    setSaving(true);
    try {
      const options: Record<string, unknown> = {};
      if (name.trim()) options.name = name.trim();
      if (unique) options.unique = true;
      if (sparse) options.sparse = true;
      if (ttl) options.expireAfterSeconds = Number(ttl);
      if (partial.trim()) options.partialFilterExpression = partial.trim();
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keysEjson: keys, options }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Index "${data.name}" created`);
      onCreated();
    } catch (err) {
      toast.error("Create failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-x-4 inset-y-8 lg:inset-x-16 lg:inset-y-12 max-w-2xl mx-auto bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30">
          <h2 className="font-semibold text-sm">Create index</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="idx-keys">Key spec (EJSON)</Label>
            <Input
              id="idx-keys"
              value={keys}
              onChange={(e) => setKeys(e.target.value)}
              className="font-mono"
              spellCheck={false}
            />
            {!validKeys ? (
              <p className="text-[11px] text-red-500">JSON syntax error</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="idx-name">Name (optional)</Label>
            <Input
              id="idx-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="auto"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded border border-border/60 px-3 py-2">
              <Label htmlFor="idx-unique" className="text-sm">Unique</Label>
              <Switch id="idx-unique" checked={unique} onCheckedChange={setUnique} />
            </div>
            <div className="flex items-center justify-between rounded border border-border/60 px-3 py-2">
              <Label htmlFor="idx-sparse" className="text-sm">Sparse</Label>
              <Switch id="idx-sparse" checked={sparse} onCheckedChange={setSparse} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="idx-ttl">TTL — expire after seconds (optional)</Label>
            <Input
              id="idx-ttl"
              type="number"
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              placeholder="3600"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idx-partial">Partial filter expression (optional, EJSON)</Label>
            <Input
              id="idx-partial"
              value={partial}
              onChange={(e) => setPartial(e.target.value)}
              className="font-mono"
              placeholder='{"status": "active"}'
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/30">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={create} disabled={!validKeys || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
