"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  Check,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

interface InstalledExtension {
  name: string;
  schema: string;
  installedVersion: string;
  defaultVersion: string | null;
  updateAvailable: boolean;
  comment: string | null;
}

interface AvailableExtension {
  name: string;
  defaultVersion: string | null;
  comment: string | null;
}

interface ExtensionsResponse {
  database: string;
  installed: InstalledExtension[];
  available: AvailableExtension[];
}

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

export function ExtensionsClient({ connectionId, defaultDatabase }: Props) {
  const [database, setDatabase] = useState(defaultDatabase);
  const [databases, setDatabases] = useState<string[]>([defaultDatabase]);
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [available, setAvailable] = useState<AvailableExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<InstalledExtension | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/extensions?db=${encodeURIComponent(database)}`,
        { cache: "no-store", signal: ac.signal },
      );
      const data = (await res.json()) as ExtensionsResponse | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Failed");
      }
      setInstalled(data.installed);
      setAvailable(data.available);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  // Fetch databases for the database selector once.
  useEffect(() => {
    void fetch(`/api/postgres/${connectionId}/databases`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          databases?: Array<{ name: string }>;
        };
        if (data.databases) {
          setDatabases(data.databases.map((d) => d.name));
        }
      })
      .catch(() => {});
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (
      action: "create" | "drop" | "update",
      name: string,
      opts: { cascade?: boolean } = {},
    ) => {
      setBusy(`${action}:${name}`);
      try {
        const res = await fetch(`/api/postgres/${connectionId}/extensions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, name, db: database, ...opts }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Failed");
        toast.success(
          action === "create"
            ? `Installed ${name}`
            : action === "drop"
              ? `Removed ${name}`
              : `Updated ${name}`,
        );
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [connectionId, database, load],
  );

  const installedFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return installed;
    return installed.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.comment?.toLowerCase().includes(q),
    );
  }, [installed, query]);

  const availableFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.comment?.toLowerCase().includes(q),
    );
  }, [available, query]);

  const updates = installed.filter((e) => e.updateAvailable);

  return (
    <WorkspacePage
      title="Extensions"
      description="PostgreSQL extensions are scoped per database — pick a database, install or remove."
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={database}
            onValueChange={(v) => v && setDatabase(v)}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {databases.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RefreshButton onClick={load} loading={loading} />
        </div>
      }
    >
      {error ? (
        <div className="mx-6 mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      ) : null}

      <div className="px-6 pb-10 space-y-6">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter extensions…"
            className="pl-8 h-8"
          />
        </div>

        {updates.length > 0 ? (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/5">
            <header className="flex items-center justify-between border-b border-amber-500/30 px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <ArrowUpCircle className="size-3.5" />
                {updates.length} update{updates.length === 1 ? "" : "s"} available
              </div>
            </header>
            <ul className="divide-y divide-amber-500/20">
              {updates.map((e) => (
                <li
                  key={e.name}
                  className="flex items-center gap-3 px-4 py-2 text-sm"
                >
                  <span className="font-mono font-medium flex-1 truncate">
                    {e.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.installedVersion} → {e.defaultVersion}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `update:${e.name}`}
                    onClick={() => run("update", e.name)}
                    className="gap-1.5"
                  >
                    {busy === `update:${e.name}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ArrowUpCircle className="size-3" />
                    )}
                    Update
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <header className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wider font-mono text-muted-foreground flex items-center gap-1.5">
              <Check className="size-3" />
              Installed ({installed.length})
            </h2>
            <span className="text-[10px] font-mono text-muted-foreground">
              {database}
            </span>
          </header>
          <ExtensionGrid
            items={installedFiltered}
            kind="installed"
            busy={busy}
            onDrop={(e) => setDropTarget(e)}
          />
        </section>

        <section>
          <header className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wider font-mono text-muted-foreground flex items-center gap-1.5">
              <Package className="size-3" />
              Available ({availableFiltered.length})
            </h2>
            <span className="text-[10px] font-mono text-muted-foreground">
              Not installed yet
            </span>
          </header>
          <ExtensionGrid
            items={availableFiltered}
            kind="available"
            busy={busy}
            onCreate={(e) => run("create", e.name, { cascade: true })}
          />
        </section>
      </div>

      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop extension {dropTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Uninstalls the extension from <span className="font-mono">{database}</span>.
              Use CASCADE to drop dependent objects too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const t = dropTarget;
                if (!t) return;
                setDropTarget(null);
                await run("drop", t.name);
              }}
            >
              Drop
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                const t = dropTarget;
                if (!t) return;
                setDropTarget(null);
                await run("drop", t.name, { cascade: true });
              }}
            >
              Drop with CASCADE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

interface ExtensionGridProps {
  items: Array<InstalledExtension | AvailableExtension>;
  kind: "installed" | "available";
  busy: string | null;
  onCreate?: (e: AvailableExtension) => void;
  onDrop?: (e: InstalledExtension) => void;
}

function ExtensionGrid({ items, kind, busy, onCreate, onDrop }: ExtensionGridProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
        Nothing here.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      {items.map((e) => {
        const installed = "installedVersion" in e;
        const busyKey = installed ? `drop:${e.name}` : `create:${e.name}`;
        return (
          <div
            key={e.name}
            className={cn(
              "group rounded-lg border bg-card/40 px-3 py-2.5 transition-colors",
              kind === "installed"
                ? "border-border/60 hover:border-border"
                : "border-border/40 hover:border-border/80",
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-medium truncate">
                  {e.name}
                </div>
                {e.comment ? (
                  <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
                    {e.comment}
                  </div>
                ) : null}
                <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-muted-foreground">
                  {installed ? (
                    <>
                      <span>v{(e as InstalledExtension).installedVersion}</span>
                      <span>·</span>
                      <span>schema: {(e as InstalledExtension).schema}</span>
                    </>
                  ) : (
                    <span>
                      {(e as AvailableExtension).defaultVersion
                        ? `v${(e as AvailableExtension).defaultVersion}`
                        : "no default version"}
                    </span>
                  )}
                </div>
              </div>
              {installed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 p-0 text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  disabled={busy === busyKey}
                  onClick={() => onDrop?.(e as InstalledExtension)}
                  aria-label={`Drop ${e.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  disabled={busy === busyKey}
                  onClick={() => onCreate?.(e as AvailableExtension)}
                >
                  {busy === busyKey ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  Install
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
