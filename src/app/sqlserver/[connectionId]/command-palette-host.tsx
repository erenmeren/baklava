"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Box, Columns3, FileCode2, Search, Table as TableIcon, View } from "lucide-react";

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

interface ObjectRow {
  schema: string;
  name: string;
  kind: string;
}

interface Hit {
  label: string;
  meta: string;
  href: string;
  kind: string;
  score: number;
}

function fuzzy(haystack: string, needle: string): number {
  if (!needle) return 1;
  const H = haystack.toLowerCase();
  const N = needle.toLowerCase();
  if (H === N) return 1000;
  if (H.startsWith(N)) return 500;
  const idx = H.indexOf(N);
  if (idx >= 0) return 200 - idx;
  let hi = 0;
  let ni = 0;
  let score = 0;
  while (hi < H.length && ni < N.length) {
    if (H[hi] === N[ni]) {
      score += 1;
      ni++;
    }
    hi++;
  }
  return ni === N.length ? score : 0;
}

export function CommandPaletteHost({ connectionId, defaultDatabase }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (objects.length === 0) {
      void fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/objects`,
        { cache: "no-store" },
      )
        .then(async (r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.objects) setObjects(d.objects as ObjectRow[]);
        })
        .catch(() => {});
    }
  }, [open, connectionId, defaultDatabase, objects.length]);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim();
    const out: Hit[] = [];
    for (const o of objects) {
      const fqn = `${o.schema}.${o.name}`;
      const score = q ? fuzzy(fqn, q) : 1;
      if (score <= 0) continue;
      const href =
        o.kind === "table"
          ? `/sqlserver/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/tables/${encodeURIComponent(o.schema)}/${encodeURIComponent(o.name)}`
          : `/sqlserver/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/modules/${encodeURIComponent(o.schema)}/${encodeURIComponent(o.name)}`;
      out.push({ label: o.name, meta: `${o.schema} · ${o.kind}`, href, kind: o.kind, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 50);
  }, [objects, query, connectionId, defaultDatabase]);

  useEffect(() => setSelected(0), [query]);

  const choose = useCallback(
    (h: Hit) => {
      router.push(h.href);
      setOpen(false);
    },
    [router],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Object search</DialogTitle>
        <div className="relative border-b border-border/60 flex items-center">
          <Search className="absolute left-4 size-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (hits[selected]) choose(hits[selected]);
              }
            }}
            placeholder={`Find a table, view, or proc in ${defaultDatabase}…`}
            className="flex-1 h-12 pl-12 pr-3 bg-transparent text-base outline-none"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {hits.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              {objects.length === 0 ? "Loading objects…" : "No matches."}
            </li>
          ) : (
            hits.map((h, i) => (
              <li key={`${h.href}-${i}`}>
                <button
                  type="button"
                  onClick={() => choose(h)}
                  onMouseEnter={() => setSelected(i)}
                  className={cn(
                    "w-full flex items-baseline gap-3 px-4 py-2 text-left transition-colors",
                    selected === i ? "bg-brand/10 text-foreground" : "hover:bg-muted/40",
                  )}
                >
                  <KindIcon kind={h.kind} />
                  <span className="flex-1 min-w-0 font-mono text-sm truncate">{h.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[40%]">
                    {h.meta}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-border/60 px-4 py-1.5 text-[10px] font-mono text-muted-foreground">
          ↑/↓ navigate · enter open · esc close
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground translate-y-[1px]";
  if (kind === "table") return <TableIcon className={cls} />;
  if (kind === "view") return <View className={cls} />;
  if (kind === "proc" || kind === "scalar_fn" || kind === "table_fn")
    return <FileCode2 className={cls} />;
  if (kind === "column") return <Columns3 className={cls} />;
  return <Box className={cls} />;
}
