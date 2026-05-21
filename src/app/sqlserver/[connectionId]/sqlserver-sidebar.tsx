"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronRight,
  Database,
  DatabaseBackup,
  Eye,
  FileCode,
  Folder,
  FunctionSquare,
  Link2,
  ListOrdered,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Server,
  ShieldCheck,
  Store,
  Table as TableIcon,
  Wrench,
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
import { CreateDatabaseDialog } from "./create-database-dialog";
import { CreateSchemaDialog } from "./create-schema-dialog";
import { CreateTableDialog } from "./create-table-dialog";

interface DatabaseInfo {
  name: string;
  state: string;
  tableCount: number;
}

interface SqlObject {
  schema: string;
  name: string;
  /** table | view | proc | scalar_fn | table_fn | trigger | synonym */
  kind: string;
  type: string;
}

// Tree groups, in display order. SQL Server loads every object for a database
// in one fetch (/objects), so unlike Postgres we group client-side rather than
// lazy-loading each group.
type GroupKind =
  | "tables"
  | "views"
  | "procedures"
  | "functions"
  | "synonyms"
  | "triggers";

const KIND_TO_GROUP: Record<string, GroupKind> = {
  table: "tables",
  view: "views",
  proc: "procedures",
  scalar_fn: "functions",
  table_fn: "functions",
  synonym: "synonyms",
  trigger: "triggers",
};

const GROUP_ORDER: GroupKind[] = [
  "tables",
  "views",
  "procedures",
  "functions",
  "synonyms",
  "triggers",
];

const GROUP_LABEL: Record<GroupKind, string> = {
  tables: "Tables",
  views: "Views",
  procedures: "Procedures",
  functions: "Functions",
  synonyms: "Synonyms",
  triggers: "Triggers",
};

function groupIcon(kind: GroupKind) {
  const className = "size-3 text-muted-foreground";
  switch (kind) {
    case "tables":
      return <TableIcon className={className} />;
    case "views":
      return <Eye className={className} />;
    case "procedures":
      return <FileCode className={className} />;
    case "functions":
      return <FunctionSquare className={className} />;
    case "synonyms":
      return <Link2 className={className} />;
    case "triggers":
      return <Zap className={className} />;
  }
}

function objectIcon(kind: GroupKind) {
  const className = "size-3 shrink-0";
  switch (kind) {
    case "tables":
      return <TableIcon className={className} />;
    case "views":
      return <Eye className={className} />;
    case "procedures":
      return <FileCode className={className} />;
    case "functions":
      return <FunctionSquare className={className} />;
    case "synonyms":
      return <Link2 className={className} />;
    case "triggers":
      return <Zap className={className} />;
  }
}

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

export function SqlServerSidebar({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname() ?? "";

  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [openDb, setOpenDb] = useState<Record<string, boolean>>({
    [defaultDatabase]: true,
  });
  const [objectsByDb, setObjectsByDb] = useState<
    Record<string, SqlObject[] | undefined>
  >({});
  const [schemasByDb, setSchemasByDb] = useState<
    Record<string, string[] | undefined>
  >({});
  const [openSchema, setOpenSchema] = useState<Record<string, boolean>>({});
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({});
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create dialogs.
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createSchemaDb, setCreateSchemaDb] = useState<string | null>(null);
  const [createTableTarget, setCreateTableTarget] = useState<{
    db: string;
    schema: string;
  } | null>(null);

  const loadDatabases = useCallback(async () => {
    setLoadingDbs(true);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/databases`, {
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

  // Load a database's schemas (authoritative list, so empty schemas show) and
  // its objects (grouped under each schema) in parallel.
  const loadDb = useCallback(
    async (db: string) => {
      const base = `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(db)}`;
      const [objectsRes, schemasRes] = await Promise.allSettled([
        fetch(`${base}/objects`, { cache: "no-store" }),
        fetch(`${base}/schemas`, { cache: "no-store" }),
      ]);
      if (objectsRes.status === "fulfilled" && objectsRes.value.ok) {
        const data = await objectsRes.value.json();
        setObjectsByDb((s) => ({ ...s, [db]: (data.objects as SqlObject[]) ?? [] }));
      } else {
        setObjectsByDb((s) => ({ ...s, [db]: [] }));
      }
      if (schemasRes.status === "fulfilled" && schemasRes.value.ok) {
        const data = await schemasRes.value.json();
        setSchemasByDb((s) => ({ ...s, [db]: (data.schemas as string[]) ?? [] }));
      } else {
        setSchemasByDb((s) => ({ ...s, [db]: [] }));
      }
    },
    [connectionId],
  );

  // Auto-load the default (open) database on first paint.
  useEffect(() => {
    if (databases && openDb[defaultDatabase] && !objectsByDb[defaultDatabase]) {
      loadDb(defaultDatabase);
    }
  }, [databases, defaultDatabase, openDb, objectsByDb, loadDb]);

  const toggleDb = (db: string) => {
    const next = !openDb[db];
    setOpenDb((s) => ({ ...s, [db]: next }));
    if (next && !objectsByDb[db]) loadDb(db);
  };

  const toggleSchema = (db: string, schema: string) => {
    const key = `${db}.${schema}`;
    const next = !openSchema[key];
    setOpenSchema((s) => ({ ...s, [key]: next }));
    if (next) {
      // Auto-open the Tables group on first expansion.
      setOpenGroup((s) => ({ ...s, [`${key}.tables`]: true }));
    }
  };

  const toggleGroup = (db: string, schema: string, kind: GroupKind) => {
    const gk = `${db}.${schema}.${kind}`;
    setOpenGroup((s) => ({ ...s, [gk]: !s[gk] }));
  };

  const refreshAll = () => {
    setObjectsByDb({});
    setSchemasByDb({});
    setRefreshKey((n) => n + 1);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  // ----- Server section -----------------------------------------------------

  const serverLinks = useMemo(
    () => [
      { href: `/sqlserver/${connectionId}/activity`, label: "Activity", icon: Activity },
      { href: `/sqlserver/${connectionId}/queries`, label: "Top queries", icon: ListOrdered },
      { href: `/sqlserver/${connectionId}/locks`, label: "Locks", icon: Lock },
      { href: `/sqlserver/${connectionId}/query-store`, label: "Query Store", icon: Store },
      { href: `/sqlserver/${connectionId}/indexes`, label: "Index maintenance", icon: Wrench },
      { href: `/sqlserver/${connectionId}/security`, label: "Security", icon: ShieldCheck },
      { href: `/sqlserver/${connectionId}/backup`, label: "Backup", icon: DatabaseBackup },
    ],
    [connectionId],
  );

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
            onClick={() => setCreateDbOpen(true)}
            title="New database"
          >
            <Plus className="size-3" />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={refreshAll} title="Refresh">
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
        <div className="px-2 py-1 text-xs text-muted-foreground">(no databases)</div>
      ) : (
        <ul>
          {databases.map((db) => {
            const objects = objectsByDb[db.name];
            return (
              <li key={db.name}>
                <DatabaseRow
                  db={db}
                  isOpen={!!openDb[db.name]}
                  onToggle={() => toggleDb(db.name)}
                  onRefresh={() => {
                    setObjectsByDb((s) => ({ ...s, [db.name]: undefined }));
                    setSchemasByDb((s) => ({ ...s, [db.name]: undefined }));
                    loadDb(db.name);
                  }}
                  onCreateSchema={() => setCreateSchemaDb(db.name)}
                  onCopyName={() => copy(db.name)}
                />
                {openDb[db.name] ? (
                  <ul className="ml-4 border-l border-border/50">
                    {objects === undefined ? (
                      <li className="px-2 py-1 text-xs text-muted-foreground">
                        Loading…
                      </li>
                    ) : (
                      <SchemaList
                        connectionId={connectionId}
                        db={db.name}
                        objects={objects}
                        schemas={schemasByDb[db.name] ?? []}
                        pathname={pathname}
                        openSchema={openSchema}
                        openGroup={openGroup}
                        onToggleSchema={(schema) => toggleSchema(db.name, schema)}
                        onToggleGroup={(schema, kind) =>
                          toggleGroup(db.name, schema, kind)
                        }
                        onCreateTable={(schema) =>
                          setCreateTableTarget({ db: db.name, schema })
                        }
                        onCopy={copy}
                      />
                    )}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-2 pt-3 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Server className="size-3" />
          Server
        </span>
      </div>
      {serverLinks.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className={serverLinkClass(pathname === href)}>
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
      ))}

      {/* Create dialogs */}
      <CreateDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        connectionId={connectionId}
        onCreated={() => refreshAll()}
      />
      {createSchemaDb ? (
        <CreateSchemaDialog
          open
          onOpenChange={(v) => {
            if (!v) setCreateSchemaDb(null);
          }}
          connectionId={connectionId}
          database={createSchemaDb}
          onCreated={() => {
            const db = createSchemaDb;
            if (!db) return;
            setOpenDb((s) => ({ ...s, [db]: true }));
            // Reload so the new schema shows in the tree.
            setObjectsByDb((s) => ({ ...s, [db]: undefined }));
            setSchemasByDb((s) => ({ ...s, [db]: undefined }));
            loadDb(db);
          }}
        />
      ) : null}
      {createTableTarget ? (
        <CreateTableDialog
          open
          onOpenChange={(v) => {
            if (!v) setCreateTableTarget(null);
          }}
          connectionId={connectionId}
          database={createTableTarget.db}
          schema={createTableTarget.schema}
          onCreated={() => {
            const t = createTableTarget;
            if (!t) return;
            setOpenDb((s) => ({ ...s, [t.db]: true }));
            setOpenSchema((s) => ({ ...s, [`${t.db}.${t.schema}`]: true }));
            setOpenGroup((s) => ({ ...s, [`${t.db}.${t.schema}.tables`]: true }));
            setObjectsByDb((s) => ({ ...s, [t.db]: undefined }));
            setSchemasByDb((s) => ({ ...s, [t.db]: undefined }));
            loadDb(t.db);
          }}
        />
      ) : null}
    </div>
  );
}

// ===== Sub-components =======================================================

function SchemaList({
  connectionId,
  db,
  objects,
  schemas: schemaNames,
  pathname,
  openSchema,
  openGroup,
  onToggleSchema,
  onToggleGroup,
  onCreateTable,
  onCopy,
}: {
  connectionId: string;
  db: string;
  objects: SqlObject[];
  /** Authoritative schema list, so empty / freshly-created schemas show. */
  schemas: string[];
  pathname: string;
  openSchema: Record<string, boolean>;
  openGroup: Record<string, boolean>;
  onToggleSchema: (schema: string) => void;
  onToggleGroup: (schema: string, kind: GroupKind) => void;
  onCreateTable: (schema: string) => void;
  onCopy: (text: string) => void;
}) {
  // Group objects: schema → groupKind → objects.
  const bySchema = useMemo(() => {
    const map = new Map<string, Map<GroupKind, SqlObject[]>>();
    for (const o of objects) {
      const group = KIND_TO_GROUP[o.kind];
      if (!group) continue;
      let groups = map.get(o.schema);
      if (!groups) {
        groups = new Map();
        map.set(o.schema, groups);
      }
      const arr = groups.get(group) ?? [];
      arr.push(o);
      groups.set(group, arr);
    }
    return map;
  }, [objects]);

  // Union of the authoritative schema list with any schema that owns objects
  // (defensive — the two should already agree).
  const schemas = useMemo(() => {
    const set = new Set<string>(schemaNames);
    for (const k of bySchema.keys()) set.add(k);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [schemaNames, bySchema]);

  if (schemas.length === 0) {
    return (
      <li className="px-2 py-1 text-xs text-muted-foreground">(no schemas)</li>
    );
  }

  return (
    <>
      {schemas.map((schema) => {
        const key = `${db}.${schema}`;
        const isOpen = !!openSchema[key];
        const groups = bySchema.get(schema) ?? new Map<GroupKind, SqlObject[]>();
        const hasObjects = groups.size > 0;
        return (
          <li key={schema}>
            <SchemaRow
              name={schema}
              isOpen={isOpen}
              onToggle={() => onToggleSchema(schema)}
              onCreateTable={() => onCreateTable(schema)}
              onCopyName={() => onCopy(schema)}
            />
            {isOpen ? (
              <ul className="ml-4 border-l border-border/50">
                {!hasObjects ? (
                  <li className="px-2 py-1 text-[11px] text-muted-foreground/70 italic">
                    empty
                  </li>
                ) : (
                  GROUP_ORDER.map((kind) => {
                    const items = groups.get(kind) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <Group
                        key={kind}
                        kind={kind}
                        items={items}
                        isOpen={!!openGroup[`${key}.${kind}`]}
                        onToggle={() => onToggleGroup(schema, kind)}
                        renderItem={(o) => (
                          <ObjectRow
                            key={`${kind}:${o.name}`}
                            connectionId={connectionId}
                            db={db}
                            object={o}
                            group={kind}
                            pathname={pathname}
                            onCopy={() => onCopy(`${o.schema}.${o.name}`)}
                          />
                        )}
                      />
                    );
                  })
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

function DatabaseRow({
  db,
  isOpen,
  onToggle,
  onRefresh,
  onCreateSchema,
  onCopyName,
}: {
  db: DatabaseInfo;
  isOpen: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onCreateSchema: () => void;
  onCopyName: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const offline = db.state !== "ONLINE";
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
        title={offline ? `${db.name} · ${db.state}` : db.name}
      >
        <ChevronRight
          className={cn(
            "size-3 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
        />
        <Database
          className={cn(
            "size-3.5",
            offline ? "text-amber-500" : "text-muted-foreground",
          )}
        />
        <span className={cn("truncate font-mono text-xs", offline && "text-muted-foreground/70")}>
          {db.name}
        </span>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="opacity-0 group-hover/db:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-opacity outline-none"
          title="Database actions"
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onCreateSchema}>
            <Plus className="size-3.5" />
            New schema…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRefresh}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCopyName}>Copy name</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SchemaRow({
  name,
  isOpen,
  onToggle,
  onCreateTable,
  onCopyName,
}: {
  name: string;
  isOpen: boolean;
  onToggle: () => void;
  onCreateTable: () => void;
  onCopyName: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="group/schema-row flex items-center pr-1 rounded-md hover:bg-foreground/5 transition-colors"
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
        <Folder className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{name}</span>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="opacity-0 group-hover/schema-row:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-opacity outline-none"
          title="Schema actions"
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onCreateTable}>
            <Plus className="size-3.5" />
            New table…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCopyName}>Copy name</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Group({
  kind,
  items,
  isOpen,
  onToggle,
  renderItem,
}: {
  kind: GroupKind;
  items: SqlObject[];
  isOpen: boolean;
  onToggle: () => void;
  renderItem: (item: SqlObject) => React.ReactNode;
}) {
  return (
    <li>
      <div className="group/grp flex items-center pr-1 rounded-md hover:bg-foreground/5 transition-colors">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 flex-1 min-w-0 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", isOpen && "rotate-90")}
          />
          {groupIcon(kind)}
          <span>{GROUP_LABEL[kind]}</span>
          <span className="ml-auto font-mono normal-case tracking-normal text-[10px] text-muted-foreground/70">
            {items.length}
          </span>
        </button>
      </div>
      {isOpen ? (
        <ul className="ml-4 border-l border-border/40">
          {items.map((item) => renderItem(item))}
        </ul>
      ) : null}
    </li>
  );
}

function ObjectRow({
  connectionId,
  db,
  object,
  group,
  pathname,
  onCopy,
}: {
  connectionId: string;
  db: string;
  object: SqlObject;
  group: GroupKind;
  pathname: string;
  onCopy: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Tables & views → table-detail page; procs / functions / triggers →
  // module-detail page. Synonyms have no detail view, so they render as a
  // muted, non-navigable leaf.
  const base = `/sqlserver/${connectionId}/databases/${encodeURIComponent(db)}`;
  const href =
    group === "tables" || group === "views"
      ? `${base}/tables/${encodeURIComponent(object.schema)}/${encodeURIComponent(object.name)}`
      : group === "synonyms"
        ? null
        : `${base}/modules/${encodeURIComponent(object.schema)}/${encodeURIComponent(object.name)}`;

  const active = href ? pathname.startsWith(href) : false;

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
        {href ? (
          <Link
            href={href}
            className={cn(
              "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs transition-colors font-mono",
              active ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {objectIcon(group)}
            <span className="truncate">{object.name}</span>
          </Link>
        ) : (
          <span
            className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs font-mono text-muted-foreground/70"
            title={`synonym · ${object.schema}.${object.name}`}
          >
            {objectIcon(group)}
            <span className="truncate">{object.name}</span>
          </span>
        )}
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
