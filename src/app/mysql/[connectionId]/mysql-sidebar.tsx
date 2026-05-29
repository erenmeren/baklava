"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronRight,
  Database,
  Eye,
  ListOrdered,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Server,
  Table as TableIcon,
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
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { CreateDatabaseDialog } from "./create-database-dialog";
import { CreateTableDialog } from "./create-table-dialog";
import { DropConfirm, type DropTarget } from "./drop-confirm";

interface DatabaseInfo {
  name: string;
  charset: string;
  collation: string;
  system: boolean;
}

interface TableInfo {
  name: string;
  kind: "table" | "view";
}

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

export function MysqlSidebar({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // ----- Tree state ---------------------------------------------------------

  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [openDb, setOpenDb] = useState<Record<string, boolean>>(
    defaultDatabase ? { [defaultDatabase]: true } : {},
  );
  const [tablesByDb, setTablesByDb] = useState<Record<string, TableInfo[]>>({});
  const [systemOpen, setSystemOpen] = useState(false);

  const [loadingDbs, setLoadingDbs] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // ----- Dialog state -------------------------------------------------------

  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createTableDb, setCreateTableDb] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // ----- Data loaders -------------------------------------------------------

  const loadDatabases = useCallback(async () => {
    setLoadingDbs(true);
    try {
      const res = await fetch(`/api/mysql/${connectionId}/databases`, {
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

  const loadTables = useCallback(
    async (db: string) => {
      const res = await fetch(
        `/api/mysql/${connectionId}/databases/${encodeURIComponent(db)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setTablesByDb((s) => ({ ...s, [db]: data.tables as TableInfo[] }));
      }
    },
    [connectionId],
  );

  useEffect(() => {
    if (
      databases &&
      defaultDatabase &&
      openDb[defaultDatabase] &&
      !tablesByDb[defaultDatabase]
    ) {
      loadTables(defaultDatabase);
    }
  }, [databases, defaultDatabase, openDb, tablesByDb, loadTables]);

  // ----- Toggles ------------------------------------------------------------

  const toggleDb = (db: string) => {
    const next = !openDb[db];
    setOpenDb((s) => ({ ...s, [db]: next }));
    if (next && !tablesByDb[db]) loadTables(db);
  };

  // ----- Actions ------------------------------------------------------------

  const refreshAll = () => {
    setTablesByDb({});
    setRefreshKey((n) => n + 1);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const openQuery = (db: string) => {
    router.push(
      `/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`,
    );
  };

  const selectTop100 = (db: string, table: string) => {
    const qid = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const sql = `SELECT *\nFROM \`${table}\`\nLIMIT 100;\n`;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        `baklava:my-query-sql:${connectionId}:${db}:${qid}`,
        sql,
      );
    }
    router.push(
      `/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query/${qid}`,
    );
  };

  // ----- Render -------------------------------------------------------------

  const processlistHref = `/mysql/${connectionId}/processlist`;
  const processlistActive = pathname === processlistHref;

  const serverLinkClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 px-2 py-1 ml-2 rounded-md text-xs font-mono transition-colors",
      active
        ? "bg-foreground/10 text-foreground font-medium"
        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
    );

  const userDbs = databases?.filter((d) => !d.system) ?? [];
  const systemDbs = databases?.filter((d) => d.system) ?? [];

  const renderDb = (db: DatabaseInfo) => {
    const tables = tablesByDb[db.name];
    return (
      <li key={db.name}>
        <DatabaseRow
          db={db}
          isOpen={!!openDb[db.name]}
          onToggle={() => toggleDb(db.name)}
          onCreateTable={() => setCreateTableDb(db.name)}
          onOpenQuery={() => openQuery(db.name)}
          onRefresh={() => {
            setTablesByDb((s) => {
              const next = { ...s };
              delete next[db.name];
              return next;
            });
            loadTables(db.name);
          }}
          onCopyName={() => copy(db.name)}
          onDrop={() => setDropTarget({ kind: "database", database: db.name })}
        />
        {openDb[db.name] ? (
          <ul className="ml-4 border-l border-border/50">
            {!tables ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                Loading…
              </li>
            ) : tables.length === 0 ? (
              <li className="px-2 py-1 text-[11px] text-muted-foreground/70 italic">
                (no tables)
              </li>
            ) : (
              tables.map((t) => (
                <TableRow
                  key={t.name}
                  table={t}
                  href={`/mysql/${connectionId}/databases/${encodeURIComponent(db.name)}/tables/${encodeURIComponent(t.name)}`}
                  pathname={pathname}
                  onSelectTop100={() => selectTop100(db.name, t.name)}
                  onCopyName={() => copy(`${db.name}.${t.name}`)}
                  onTruncate={() =>
                    setDropTarget({
                      kind: "table",
                      database: db.name,
                      name: t.name,
                      objectKind: t.kind,
                      truncate: true,
                    })
                  }
                  onDrop={() =>
                    setDropTarget({
                      kind: "table",
                      database: db.name,
                      name: t.name,
                      objectKind: t.kind,
                    })
                  }
                />
              ))
            )}
          </ul>
        ) : null}
      </li>
    );
  };

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
            onClick={() => setCreateDbOpen(true)}
            title="New database"
          >
            <Plus className="size-3" />
          </Button>
          <RefreshButton
            onClick={refreshAll}
            loading={loadingDbs}
            iconOnly
            size="icon-xs"
            variant="ghost"
          />
        </div>
      </div>

      {databases === null ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
      ) : (
        <ul>
          {userDbs.map(renderDb)}

          {systemDbs.length > 0 ? (
            <li>
              <button
                onClick={() => setSystemOpen((v) => !v)}
                className="group/sys flex items-center gap-1 w-full px-2 py-1 rounded-md text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/5 transition-colors text-left"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    systemOpen && "rotate-90",
                  )}
                />
                <Server className="size-3" />
                <span>System</span>
                <span className="ml-auto font-mono normal-case tracking-normal text-[10px] text-muted-foreground/50">
                  {systemDbs.length}
                </span>
              </button>
              {systemOpen ? (
                <ul className="ml-4 border-l border-border/40 opacity-70">
                  {systemDbs.map(renderDb)}
                </ul>
              ) : null}
            </li>
          ) : null}
        </ul>
      )}

      <div className="px-2 pt-3 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Server className="size-3" />
          Server
        </span>
      </div>
      <Link
        href={processlistHref}
        className={serverLinkClass(processlistActive)}
      >
        <Activity className="size-3 shrink-0" />
        <span className="truncate">Process list</span>
      </Link>

      {/* Dialogs */}
      <CreateDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        connectionId={connectionId}
        onCreated={() => {
          setRefreshKey((n) => n + 1);
        }}
      />

      {createTableDb ? (
        <CreateTableDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setCreateTableDb(null);
          }}
          connectionId={connectionId}
          database={createTableDb}
          onCreated={() => {
            const db = createTableDb;
            if (!db) return;
            setOpenDb((s) => ({ ...s, [db]: true }));
            setTablesByDb((s) => {
              const next = { ...s };
              delete next[db];
              return next;
            });
            loadTables(db);
          }}
        />
      ) : null}

      <DropConfirm
        open={dropTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDropTarget(null);
        }}
        connectionId={connectionId}
        target={dropTarget}
        onDropped={(t) => {
          if (t.kind === "database") {
            setRefreshKey((n) => n + 1);
            setOpenDb((s) => {
              const next = { ...s };
              delete next[t.database];
              return next;
            });
            return;
          }
          // table dropped or truncated — reload that database's tables.
          setTablesByDb((s) => {
            const next = { ...s };
            delete next[t.database];
            return next;
          });
          loadTables(t.database);
        }}
      />
    </div>
  );
}

// ===== Sub-components =======================================================

function DatabaseRow({
  db,
  isOpen,
  onToggle,
  onCreateTable,
  onOpenQuery,
  onRefresh,
  onCopyName,
  onDrop,
}: {
  db: DatabaseInfo;
  isOpen: boolean;
  onToggle: () => void;
  onCreateTable: () => void;
  onOpenQuery: () => void;
  onRefresh: () => void;
  onCopyName: () => void;
  onDrop: () => void;
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
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="opacity-0 group-hover/db:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-opacity outline-none"
          title="Database actions"
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onCreateTable}>
            <Plus className="size-3.5" />
            New table…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenQuery}>
            <ListOrdered className="size-3.5" />
            Open query
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCopyName}>Copy name</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRefresh}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDrop}
            className="text-destructive focus:text-destructive"
          >
            Drop database…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TableRow({
  table,
  href,
  pathname,
  onSelectTop100,
  onCopyName,
  onTruncate,
  onDrop,
}: {
  table: TableInfo;
  href: string;
  pathname: string;
  onSelectTop100: () => void;
  onCopyName: () => void;
  onTruncate: () => void;
  onDrop: () => void;
}) {
  const active = pathname.startsWith(href);
  const [menuOpen, setMenuOpen] = useState(false);
  const isView = table.kind === "view";
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
          className={cn(
            "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs transition-colors font-mono",
            active ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          {isView ? (
            <Eye className="size-3 shrink-0" />
          ) : (
            <TableIcon className="size-3 shrink-0" />
          )}
          <span className="truncate">{table.name}</span>
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
              <DropdownMenuItem onClick={onSelectTop100}>
                <ListOrdered className="size-3.5" />
                Select top 100 rows
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCopyName}>
                Copy name
              </DropdownMenuItem>
              {!isView ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onTruncate}
                    className="text-destructive focus:text-destructive"
                  >
                    Truncate…
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDrop}
                className="text-destructive focus:text-destructive"
              >
                Drop {isView ? "view" : "table"}…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
