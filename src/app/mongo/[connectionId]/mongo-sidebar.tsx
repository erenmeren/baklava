"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronRight,
  Database,
  FileText,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCcw,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";

interface DatabaseInfo {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
}

interface CollectionInfo {
  name: string;
  type: string;
  count: number;
  size: number;
  storageSize: number;
  indexes: number;
  avgObjSize: number;
}

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

function formatSize(b: number) {
  if (!b) return "0";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

export function MongoSidebar({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [openDb, setOpenDb] = useState<Record<string, boolean>>(() =>
    defaultDatabase ? { [defaultDatabase]: true } : {},
  );
  const [collsByDb, setCollsByDb] = useState<Record<string, CollectionInfo[]>>({});
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [dropCollTarget, setDropCollTarget] = useState<
    | { db: string; name: string }
    | null
  >(null);
  const [working, setWorking] = useState(false);

  const loadDatabases = useCallback(async () => {
    setLoadingDbs(true);
    try {
      const res = await fetch(`/api/mongo/${connectionId}/databases`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setDatabases(data.databases as DatabaseInfo[]);
      }
    } finally {
      setLoadingDbs(false);
    }
  }, [connectionId]);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases, refreshKey]);

  const loadCollections = useCallback(
    async (db: string) => {
      const res = await fetch(
        `/api/mongo/${connectionId}/databases/${encodeURIComponent(db)}/collections`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setCollsByDb((s) => ({
          ...s,
          [db]: data.collections as CollectionInfo[],
        }));
      }
    },
    [connectionId],
  );

  useEffect(() => {
    if (databases && openDb[defaultDatabase] && !collsByDb[defaultDatabase]) {
      loadCollections(defaultDatabase);
    }
  }, [databases, defaultDatabase, openDb, collsByDb, loadCollections]);

  const toggleDb = (db: string) => {
    const next = !openDb[db];
    setOpenDb((s) => ({ ...s, [db]: next }));
    if (next && !collsByDb[db]) loadCollections(db);
  };

  const refreshAll = () => {
    setCollsByDb({});
    setRefreshKey((n) => n + 1);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      // ignore
    }
  };

  const base = `/mongo/${connectionId}`;
  const currentOpHref = `${base}/current-op`;
  const replHref = `${base}/repl-status`;
  const serverStatusHref = `${base}/server-status`;
  const currentOpActive = pathname === currentOpHref;
  const replActive = pathname === replHref;
  const serverStatusActive = pathname === serverStatusHref;

  const serverLinkClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 px-2 py-1 ml-2 rounded-md text-xs font-mono transition-colors",
      active
        ? "bg-foreground/10 text-foreground font-medium"
        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
    );

  return (
    <div className="space-y-1 select-none">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Database className="size-3" />
          Databases
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={refreshAll}
            title="Refresh"
            disabled={loadingDbs}
          >
            {loadingDbs ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCcw className="size-3" />
            )}
          </Button>
        </div>
      </div>

      {databases === null ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
      ) : databases.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          (no databases)
        </div>
      ) : (
        <ul>
          {databases.map((db) => (
            <li key={db.name}>
              <DatabaseRow
                db={db}
                isOpen={!!openDb[db.name]}
                onToggle={() => toggleDb(db.name)}
                onRefresh={() => {
                  setCollsByDb((s) => {
                    const next = { ...s };
                    delete next[db.name];
                    return next;
                  });
                  loadCollections(db.name);
                }}
                onCopy={() => copy(db.name)}
                onCreateCollection={() => {
                  router.push(
                    `/mongo/${connectionId}/databases/${encodeURIComponent(db.name)}`,
                  );
                }}
              />
              {openDb[db.name] ? (
                <ul className="ml-4 border-l border-border/50">
                  {!collsByDb[db.name] ? (
                    <li className="px-2 py-1 text-xs text-muted-foreground">
                      Loading…
                    </li>
                  ) : collsByDb[db.name].length === 0 ? (
                    <li className="px-2 py-1 text-[11px] text-muted-foreground/70 italic">
                      (no collections)
                    </li>
                  ) : (
                    collsByDb[db.name].map((c) => (
                      <CollectionRow
                        key={c.name}
                        coll={c}
                        href={`${base}/databases/${encodeURIComponent(db.name)}/${encodeURIComponent(c.name)}`}
                        pathname={pathname}
                        onCopy={() => copy(`${db.name}.${c.name}`)}
                        onDrop={() =>
                          setDropCollTarget({ db: db.name, name: c.name })
                        }
                      />
                    ))
                  )}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="px-2 pt-3 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <HardDrive className="size-3" />
          Server
        </span>
      </div>
      <Link href={currentOpHref} className={serverLinkClass(currentOpActive)}>
        <Zap className="size-3 shrink-0" />
        <span className="truncate">Current ops</span>
      </Link>
      <Link href={replHref} className={serverLinkClass(replActive)}>
        <Network className="size-3 shrink-0" />
        <span className="truncate">Replica set</span>
      </Link>
      <Link href={serverStatusHref} className={serverLinkClass(serverStatusActive)}>
        <Activity className="size-3 shrink-0" />
        <span className="truncate">Server status</span>
      </Link>

      <AlertDialog
        open={dropCollTarget !== null}
        onOpenChange={(v) => {
          if (!v && !working) setDropCollTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop collection?</AlertDialogTitle>
            <AlertDialogDescription>
              {dropCollTarget ? (
                <>
                  This will run{" "}
                  <span className="font-mono">
                    db.{dropCollTarget.name}.drop()
                  </span>{" "}
                  on <span className="font-mono">{dropCollTarget.db}</span>.
                  All documents and indexes will be permanently removed.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!dropCollTarget) return;
                setWorking(true);
                try {
                  const url = `/api/mongo/${connectionId}/databases/${encodeURIComponent(dropCollTarget.db)}/collections/${encodeURIComponent(dropCollTarget.name)}`;
                  const res = await fetch(url, { method: "DELETE" });
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Drop failed", { description: data.error });
                  } else {
                    toast.success(
                      `Dropped ${dropCollTarget.db}.${dropCollTarget.name}`,
                    );
                    loadCollections(dropCollTarget.db);
                    setDropCollTarget(null);
                  }
                } finally {
                  setWorking(false);
                }
              }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== Rows =================================================================

function DatabaseRow({
  db,
  isOpen,
  onToggle,
  onRefresh,
  onCopy,
  onCreateCollection,
}: {
  db: DatabaseInfo;
  isOpen: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onCreateCollection: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="group/db flex items-center pr-1 rounded-md hover:bg-foreground/5 transition-colors"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 min-w-0 px-2 py-1 text-sm text-left"
      >
        <ChevronRight
          className={cn(
            "size-3 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
        <Database className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{db.name}</span>
        {db.sizeOnDisk > 0 ? (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70 tabular-nums">
            {formatSize(db.sizeOnDisk)}
          </span>
        ) : null}
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="opacity-0 group-hover/db:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-opacity outline-none"
          title="Database actions"
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onCreateCollection}>
            <Plus className="size-3.5" />
            New collection…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCopy}>Copy name</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRefresh}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CollectionRow({
  coll,
  href,
  pathname,
  onCopy,
  onDrop,
}: {
  coll: CollectionInfo;
  href: string;
  pathname: string;
  onCopy: () => void;
  onDrop: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = pathname === href;
  const tooltip = `${coll.count.toLocaleString()} docs · ${formatSize(coll.size)} · ${coll.indexes} index${coll.indexes === 1 ? "" : "es"}`;
  return (
    <li>
      <div
        className={cn(
          "group/obj flex items-center pr-1 rounded-md transition-colors",
          active ? "bg-foreground/10" : "hover:bg-foreground/5",
        )}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <Link
          href={href}
          title={tooltip}
          className={cn(
            "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs font-mono",
            active ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          <FileText className="size-3 shrink-0" />
          <span className="truncate">{coll.name}</span>
          {coll.count > 0 ? (
            <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
              {coll.count.toLocaleString()}
            </span>
          ) : null}
        </Link>
        <div className="opacity-0 group-hover/obj:opacity-100 data-[popup-open]:opacity-100 transition-opacity">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              className="size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground outline-none"
              title="Actions"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onCopy}>Copy name</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDrop}
                className="text-destructive focus:text-destructive"
              >
                Drop collection…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
