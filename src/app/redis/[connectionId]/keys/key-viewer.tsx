"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  keyName: string;
  db?: number;
  onDelete: () => void;
  onMutate: () => void;
}

interface StringValue { kind: "string"; value: string }
interface HashValue { kind: "hash"; entries: { field: string; value: string }[] }
interface ListValue { kind: "list"; items: string[]; total: number }
interface SetValue { kind: "set"; members: string[]; total: number }
interface ZSetValue { kind: "zset"; members: { member: string; score: number }[]; total: number }
interface StreamValue {
  kind: "stream";
  entries: { id: string; fields: { field: string; value: string }[] }[];
  length: number;
}
interface JsonValue { kind: "json"; value: string }
interface UnknownValue { kind: "unknown"; type: string }
type KeyValue =
  | StringValue
  | HashValue
  | ListValue
  | SetValue
  | ZSetValue
  | StreamValue
  | JsonValue
  | UnknownValue;

interface KeyDetail {
  key: string;
  type: string;
  ttl: number;
  size: number;
  value: KeyValue;
}

const TYPE_COLOR: Record<string, string> = {
  string: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  hash: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  list: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  set: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  zset: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  stream: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "ReJSON-RL": "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
};

export function KeyViewer({
  connectionId,
  keyName,
  db,
  onDelete,
  onMutate,
}: Props) {
  const [detail, setDetail] = useState<KeyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeof db === "number") params.set("db", String(db));
      const res = await fetch(
        `/api/redis/${connectionId}/key/${encodeURIComponent(keyName)}?${params.toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `read failed (${res.status})`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [connectionId, db, keyName]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" /> loading {keyName}
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="flex-1 p-4 text-red-500 text-xs font-mono whitespace-pre-wrap">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2.5 border-b border-border/60 flex items-start justify-between gap-3 bg-muted/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "uppercase tracking-[0.18em] text-[10px] px-1.5 py-0.5 rounded",
                TYPE_COLOR[detail.type] ?? "bg-muted text-muted-foreground",
              )}
            >
              {detail.type}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
              {detail.size > 0
                ? detail.size < 1024
                  ? `${detail.size} B`
                  : detail.size < 1024 ** 2
                    ? `${(detail.size / 1024).toFixed(1)} KB`
                    : `${(detail.size / 1024 ** 2).toFixed(1)} MB`
                : ""}
            </span>
          </div>
          <div className="font-mono text-sm font-medium truncate" title={detail.key}>
            {detail.key}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TtlBadge
            ttl={detail.ttl}
            onChange={async (newTtl) => {
              const params = new URLSearchParams();
              if (typeof db === "number") params.set("db", String(db));
              const res = await fetch(
                `/api/redis/${connectionId}/key/${encodeURIComponent(keyName)}?${params.toString()}`,
                {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ ttl: newTtl }),
                },
              );
              if (res.ok) {
                toast.success(newTtl < 0 ? "TTL cleared" : `TTL set to ${newTtl}s`);
                load();
                onMutate();
              } else {
                const data = await res.json().catch(() => ({}));
                toast.error("TTL update failed", { description: data.error });
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={onDelete}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ValueBody
          detail={detail}
          onSaveString={async (value) => {
            const params = new URLSearchParams();
            if (typeof db === "number") params.set("db", String(db));
            const res = await fetch(
              `/api/redis/${connectionId}/key/${encodeURIComponent(keyName)}?${params.toString()}`,
              {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ value }),
              },
            );
            if (res.ok) {
              toast.success("Value updated");
              load();
              onMutate();
            } else {
              const data = await res.json().catch(() => ({}));
              toast.error("Update failed", { description: data.error });
            }
          }}
        />
      </div>
    </div>
  );
}

function TtlBadge({
  ttl,
  onChange,
}: {
  ttl: number;
  onChange: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(ttl > 0 ? ttl : ""));
  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          onChange(n);
          setEditing(false);
        }}
        className="flex items-center gap-1"
      >
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          className="w-20 h-7 text-xs"
          placeholder="-1 = no expire"
        />
      </form>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 text-xs rounded border border-border/60 px-2 py-1 hover:bg-foreground/5"
    >
      <Clock className="size-3" />
      {ttl === -1 ? "no expire" : ttl === -2 ? "missing" : `${ttl}s`}
    </button>
  );
}

function ValueBody({
  detail,
  onSaveString,
}: {
  detail: KeyDetail;
  onSaveString: (value: string) => void | Promise<void>;
}) {
  const value = detail.value;
  switch (value.kind) {
    case "string":
      return <StringEditor initial={value.value} onSave={onSaveString} />;
    case "hash":
      return (
        <Table
          headers={["field", "value"]}
          rows={value.entries.map((e) => [e.field, e.value])}
        />
      );
    case "list":
      return (
        <ListBody
          total={value.total}
          rows={value.items.map((v, i) => [String(i), v])}
        />
      );
    case "set":
      return (
        <ListBody
          total={value.total}
          rows={value.members.map((m) => ["", m])}
          headers={["", "member"]}
          note="(SRANDMEMBER preview — order not stable)"
        />
      );
    case "zset":
      return (
        <Table
          headers={["score", "member"]}
          rows={value.members.map((m) => [String(m.score), m.member])}
        />
      );
    case "stream":
      return (
        <div className="p-4 space-y-3">
          <div className="text-[11px] text-muted-foreground">
            length{" "}
            <span className="text-foreground tabular-nums">{value.length}</span>
            {" · "}showing latest {value.entries.length}
          </div>
          {value.entries.map((e) => (
            <div
              key={e.id}
              className="border border-border/60 rounded font-mono text-xs"
            >
              <div className="px-3 py-1.5 border-b border-border/60 bg-muted/30 text-rose-600 dark:text-rose-400">
                {e.id}
              </div>
              <table className="w-full">
                <tbody>
                  {e.fields.map((f, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-1 text-muted-foreground w-32 align-top">
                        {f.field}
                      </td>
                      <td className="px-3 py-1 whitespace-pre-wrap break-words">
                        {f.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    case "json":
      return (
        <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {(() => {
            try {
              return JSON.stringify(JSON.parse(value.value), null, 2);
            } catch {
              return value.value;
            }
          })()}
        </pre>
      );
    case "unknown":
      return (
        <div className="p-4 text-xs text-muted-foreground font-mono">
          Unsupported type: {value.type}
        </div>
      );
  }
}

function StringEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value !== initial;
  const looksJson = useState(() => {
    try {
      JSON.parse(initial);
      return true;
    } catch {
      return false;
    }
  })[0];
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-1.5 border-b border-border/60 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
        <span>
          {value.length} chars{looksJson ? " · valid JSON" : ""}
        </span>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => onSave(value)}
          className={cn(
            "h-7 text-xs",
            !dirty && "opacity-50 cursor-not-allowed",
          )}
        >
          <Save className="size-3" /> Save
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-0 p-3 font-mono text-xs outline-none resize-none bg-zinc-950 text-zinc-100 leading-relaxed"
      />
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <table className="w-full font-mono text-xs">
      <thead className="bg-muted/30 border-b border-border/60">
        <tr>
          {headers.map((h) => (
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
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/40 last:border-0">
            {r.map((v, j) => (
              <td
                key={j}
                className="px-3 py-1 align-top whitespace-pre-wrap break-words"
              >
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListBody({
  total,
  rows,
  headers = ["#", "value"],
  note,
}: {
  total: number;
  rows: string[][];
  headers?: string[];
  note?: string;
}) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/60 font-mono">
        total{" "}
        <span className="text-foreground tabular-nums">{total}</span>
        {" · showing "}
        <span className="text-foreground tabular-nums">{rows.length}</span>
        {note ? <span className="ml-2">{note}</span> : null}
      </div>
      <Table headers={headers} rows={rows} />
    </div>
  );
}
