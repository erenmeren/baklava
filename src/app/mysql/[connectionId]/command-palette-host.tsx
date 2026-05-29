"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Activity,
  Box,
  Database,
  FileText,
  Home,
  Search,
  Table as TableIcon,
  X,
} from "lucide-react";

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

interface DatabaseInfo {
  name: string;
  system: boolean;
}

interface TableInfo {
  name: string;
  kind: "table" | "view";
}

type ResultKind = "command" | "table" | "view";

interface FlatResult {
  kind: ResultKind;
  label: string;
  meta?: string;
  href: string;
  score: number;
}

// ─── tiny fuzzy matcher (same scoring as the postgres palette) ──────────────
function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1;
  const H = haystack.toLowerCase();
  const N = needle.toLowerCase();
  if (H === N) return 1000;
  if (H.startsWith(N)) return 500;
  if (H.includes(N)) return 200 + (50 - Math.min(50, H.indexOf(N)));

  let hi = 0;
  let ni = 0;
  let score = 0;
  let lastMatchedHi = -2;
  let runLen = 0;
  while (hi < H.length && ni < N.length) {
    if (H[hi] === N[ni]) {
      runLen = hi === lastMatchedHi + 1 ? runLen + 1 : 1;
      score += 1 + runLen * 2;
      if (hi === 0 || /[^a-z0-9]/.test(H[hi - 1])) score += 4;
      lastMatchedHi = hi;
      ni += 1;
    }
    hi += 1;
  }
  if (ni < N.length) return 0;
  score += Math.max(0, 20 - (H.length - N.length));
  return score;
}

/**
 * Cmd/Ctrl+K command palette for the MySQL workspace.
 *
 * MySQL has no schema layer and no recent-query / all-relations infra, so this
 * is a self-contained palette: built-in commands (Overview, New query, Process
 * list) plus a table search that lazily loads each database's tables on demand.
 */
export function CommandPaletteHost({ connectionId, defaultDatabase }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [tablesByDb, setTablesByDb] = useState<Record<string, TableInfo[]>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Database in the current URL, falling back to the connection default.
  const currentDatabase = (() => {
    const m = pathname?.match(/\/mysql\/[^/]+\/databases\/([^/]+)/) ?? null;
    const fromPath = m ? decodeURIComponent(m[1]) : "";
    if (fromPath && fromPath !== "_") return fromPath;
    return defaultDatabase;
  })();

  const queryDb = currentDatabase || "_";

  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isModK) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Reset query state on open + focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Fetch the database list once when first opened.
  useEffect(() => {
    if (!open || databases.length > 0) return;
    let cancelled = false;
    void fetch(`/api/mysql/${connectionId}/databases`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { databases?: DatabaseInfo[] };
        if (!cancelled && data.databases) {
          setDatabases(
            data.databases.map((d) => ({ name: d.name, system: d.system })),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, connectionId, databases.length]);

  // Lazy-load tables for the non-system databases when the user starts typing.
  useEffect(() => {
    if (!open || !query.trim()) return;
    for (const db of databases) {
      if (db.system) continue;
      if (tablesByDb[db.name]) continue;
      void fetch(
        `/api/mysql/${connectionId}/databases/${encodeURIComponent(db.name)}`,
        { cache: "no-store" },
      )
        .then(async (res) => {
          if (!res.ok) throw new Error("failed");
          return (await res.json()) as { tables?: TableInfo[] };
        })
        .then((data) => {
          setTablesByDb((m) => ({ ...m, [db.name]: data.tables ?? [] }));
        })
        .catch(() => {
          setTablesByDb((m) => ({ ...m, [db.name]: [] }));
        });
    }
  }, [open, query, databases, tablesByDb, connectionId]);

  const commands: FlatResult[] = useMemo(
    () => [
      {
        kind: "command",
        label: "Go to Overview",
        meta: "overview",
        href: `/mysql/${connectionId}`,
        score: 0,
      },
      {
        kind: "command",
        label: "New query",
        meta: queryDb === "_" ? "server" : queryDb,
        href: `/mysql/${connectionId}/databases/${encodeURIComponent(queryDb)}/query`,
        score: 0,
      },
      {
        kind: "command",
        label: "Process list",
        meta: "server",
        href: `/mysql/${connectionId}/processlist`,
        score: 0,
      },
    ],
    [connectionId, queryDb],
  );

  const results: FlatResult[] = useMemo(() => {
    const q = query.trim();
    const out: FlatResult[] = [];

    // Built-in commands.
    for (const c of commands) {
      const s = q ? fuzzyScore(c.label, q) : 1;
      if (s > 0) out.push({ ...c, score: s + 1000 });
    }

    // Tables across databases (only once the user has typed something).
    if (q) {
      for (const db of databases) {
        if (db.system) continue;
        const tables = tablesByDb[db.name];
        if (!tables) continue;
        for (const t of tables) {
          const fqn = `${db.name}.${t.name}`;
          const s = Math.max(fuzzyScore(t.name, q), fuzzyScore(fqn, q));
          if (s > 0) {
            out.push({
              kind: t.kind === "view" ? "view" : "table",
              label: t.name,
              meta: db.name,
              href: `/mysql/${connectionId}/databases/${encodeURIComponent(db.name)}/tables/${encodeURIComponent(t.name)}`,
              score: s,
            });
          }
        }
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, 50);
  }, [query, commands, databases, tablesByDb, connectionId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const choose = useCallback(
    (r: FlatResult) => {
      router.push(r.href);
      setOpen(false);
    },
    [router],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = results[selectedIndex];
        if (r) choose(r);
      }
    },
    [results, selectedIndex, choose],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="relative border-b border-border/60 flex items-stretch">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a command or search tables…"
            className="flex-1 h-12 pl-12 pr-3 bg-transparent text-base outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </li>
          ) : (
            results.map((r, i) => (
              <li key={`${r.kind}-${i}-${r.label}`}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    "group/row w-full flex items-baseline gap-3 px-4 py-2 text-left transition-colors",
                    selectedIndex === i
                      ? "bg-brand/10 text-foreground"
                      : "hover:bg-muted/40",
                  )}
                >
                  <KindIcon kind={r.kind} label={r.label} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm truncate">{r.label}</div>
                  </div>
                  {r.meta ? (
                    <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[40%]">
                      {r.meta}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="border-t border-border/60 px-4 py-1.5 text-[10px] font-mono text-muted-foreground">
          ↑/↓ to navigate · enter to open · esc to close
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KindIcon({ kind, label }: { kind: ResultKind; label: string }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground translate-y-[1px]";
  if (kind === "table") return <TableIcon className={cls} />;
  if (kind === "view") return <Database className={cls} />;
  // command icons keyed off label
  if (label.includes("Overview")) return <Home className={cls} />;
  if (label.includes("Process")) return <Activity className={cls} />;
  if (label.includes("query")) return <FileText className={cls} />;
  return <Box className={cls} />;
}
