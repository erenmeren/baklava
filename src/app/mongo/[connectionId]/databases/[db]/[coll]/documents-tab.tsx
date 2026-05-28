"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Search, Trash2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

interface Result {
  documents: string[];
  total: number;
  skip: number;
  limit: number;
}

type EditorMode = "insert" | "edit" | null;

export function DocumentsTab({ connectionId, dbName, collName }: Props) {
  const [filter, setFilter] = useState("{}");
  const [projection, setProjection] = useState("");
  const [sort, setSort] = useState('{"_id": -1}');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorMode>(null);
  const [editorValue, setEditorValue] = useState("");

  const url = `/api/mongo/${connectionId}/databases/${encodeURIComponent(
    dbName,
  )}/collections/${encodeURIComponent(collName)}/documents`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${url}?action=find`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter: filter || "{}",
          projection: projection || undefined,
          sort: sort || undefined,
          skip,
          limit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `find failed (${res.status})`);
      setResult(data);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filter, projection, sort, skip, limit, url]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, limit]);

  function openInsert() {
    setEditor("insert");
    setEditorValue('{\n  \n}');
  }

  function openEdit() {
    if (selected === null || !result) return;
    setEditor("edit");
    setEditorValue(result.documents[selected]);
  }

  async function saveEditor() {
    if (!editor) return;
    try {
      if (editor === "insert") {
        const res = await fetch(`${url}?action=insert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document: editorValue }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast.success("Document inserted");
      } else {
        if (selected === null || !result) return;
        const original = JSON.parse(result.documents[selected]) as { _id: unknown };
        const filterEjson = JSON.stringify({ _id: original._id });
        const res = await fetch(`${url}?action=replace`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filter: filterEjson, document: editorValue }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast.success(`Modified ${data.modified} document(s)`);
      }
      setEditor(null);
      load();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function deleteSelected() {
    if (selected === null || !result) return;
    if (!confirm("Delete this document?")) return;
    try {
      const original = JSON.parse(result.documents[selected]) as { _id: unknown };
      const filterEjson = JSON.stringify({ _id: original._id });
      const res = await fetch(`${url}?action=delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: filterEjson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Deleted ${data.deleted} document(s)`);
      load();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const page = result ? Math.floor(result.skip / result.limit) + 1 : 1;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field
          label="Filter (EJSON)"
          value={filter}
          onChange={setFilter}
          placeholder='{"status": "active"}'
        />
        <Field
          label="Projection"
          value={projection}
          onChange={setProjection}
          placeholder='{"name": 1, "_id": 0}'
        />
        <Field
          label="Sort"
          value={sort}
          onChange={setSort}
          placeholder='{"createdAt": -1}'
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Skip
          </label>
          <Input
            type="number"
            className="w-24 font-mono"
            value={skip}
            onChange={(e) => setSkip(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Limit
          </label>
          <Input
            type="number"
            className="w-24 font-mono"
            value={limit}
            onChange={(e) =>
              setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 25)))
            }
          />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Run query
        </Button>
        <Button variant="outline" onClick={openInsert}>
          <Plus className="size-4" /> Insert
        </Button>
        <Button
          variant="outline"
          disabled={selected === null}
          onClick={openEdit}
        >
          <Save className="size-4" /> Edit
        </Button>
        <Button
          variant="outline"
          disabled={selected === null}
          onClick={deleteSelected}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
        {result ? (
          <div className="ml-auto text-[11px] text-muted-foreground font-mono">
            <span className="text-foreground tabular-nums">{result.total}</span> matched
            {" · page "}
            <span className="text-foreground tabular-nums">{page}</span>/{totalPages}
            <span className="ml-3">
              <button
                disabled={skip === 0}
                onClick={() => setSkip(Math.max(0, skip - limit))}
                className="px-2 py-0.5 border border-border/60 rounded disabled:opacity-40 hover:bg-foreground/5 mr-1"
              >
                ←
              </button>
              <button
                disabled={skip + limit >= result.total}
                onClick={() => setSkip(skip + limit)}
                className="px-2 py-0.5 border border-border/60 rounded disabled:opacity-40 hover:bg-foreground/5"
              >
                →
              </button>
            </span>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2 whitespace-pre-wrap break-words">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4 min-h-[400px]">
        <div className="border border-border/60 rounded-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60 bg-muted/30">
            documents
          </div>
          <div className="flex-1 min-h-0 overflow-auto font-mono text-xs">
            {result?.documents.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground">
                no documents match the filter
              </div>
            ) : (
              result?.documents.map((doc, i) => {
                let summary = "";
                try {
                  const parsed = JSON.parse(doc) as { _id?: unknown };
                  summary = JSON.stringify(parsed._id ?? doc).slice(0, 64);
                } catch {
                  summary = doc.slice(0, 64);
                }
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(i)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 border-l-2 transition-colors truncate",
                      selected === i
                        ? "border-emerald-500 bg-emerald-500/8"
                        : "border-transparent hover:bg-foreground/[0.03]",
                    )}
                    title={summary}
                  >
                    <span className="text-muted-foreground mr-2 tabular-nums">
                      {(result?.skip ?? 0) + i + 1}
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400">
                      _id:
                    </span>{" "}
                    {summary}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="border border-border/60 rounded-md overflow-hidden flex flex-col min-h-0 bg-zinc-950">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60 bg-zinc-900/60 flex items-center justify-between">
            <span>preview · canonical EJSON</span>
            {selected !== null ? (
              <span className="text-emerald-400 tabular-nums">
                #{(result?.skip ?? 0) + selected + 1}
              </span>
            ) : null}
          </div>
          <pre className="flex-1 min-h-0 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">
            {selected !== null && result
              ? (() => {
                  try {
                    return JSON.stringify(JSON.parse(result.documents[selected]), null, 2);
                  } catch {
                    return result.documents[selected];
                  }
                })()
              : <span className="text-zinc-500 italic">select a document</span>}
          </pre>
        </div>
      </div>

      {editor ? (
        <EditorModal
          mode={editor}
          value={editorValue}
          onChange={setEditorValue}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}

function EditorModal({
  mode,
  value,
  onChange,
  onClose,
  onSave,
}: {
  mode: "insert" | "edit";
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  let valid = true;
  try {
    JSON.parse(value);
  } catch {
    valid = false;
  }
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-x-4 inset-y-8 lg:inset-x-16 lg:inset-y-12 bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 font-mono gap-3">
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              {mode === "insert" ? "insert" : "edit"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              EJSON · {valid ? "valid JSON" : "syntax error"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="size-3" /> Cancel
            </Button>
            <Button size="sm" disabled={!valid} onClick={onSave}>
              <Save className="size-3" /> Save
            </Button>
          </div>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-0 bg-zinc-950 text-zinc-100 font-mono text-[12.5px] leading-[1.6] p-4 outline-none resize-none caret-emerald-400"
        />
      </div>
    </div>
  );
}
