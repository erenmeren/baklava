"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Boxes,
  ChevronRight,
  Database,
  DatabaseBackup,
  Eye,
  FileCode,
  Folder,
  FunctionSquare,
  Hash,
  Link2,
  ListOrdered,
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Server,
  Shapes,
  ShieldCheck,
  Store,
  Table as TableIcon,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/workspace/auto-refresh";
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
import { CreateSequenceDialog } from "./create-sequence-dialog";
import { CreateSynonymDialog } from "./create-synonym-dialog";
import { CreateTypeDialog } from "./create-type-dialog";
import { CreateTableTypeDialog } from "./create-table-type-dialog";
import {
  CreateModuleDialog,
  type ModuleKind,
} from "./create-module-dialog";
import { DropConfirm, type DropTarget } from "./drop-confirm";

// Consolidated "what dialog should be open right now" state. Each variant
// carries everything its dialog needs (db + schema + optional sub-kind), so
// closing always means setCreateTarget(null) regardless of which form was up.
type CreateTarget =
  | { kind: "table"; db: string; schema: string }
  | { kind: "sequence"; db: string; schema: string }
  | { kind: "synonym"; db: string; schema: string }
  | { kind: "type"; db: string; schema: string }
  | { kind: "tableType"; db: string; schema: string }
  | { kind: "module"; moduleKind: ModuleKind; db: string; schema: string };

const GROUP_CREATE_LABEL: Record<GroupKind, string> = {
  tables: "New table",
  views: "New view",
  procedures: "New stored procedure",
  functions: "New scalar function",
  sequences: "New sequence",
  types: "New user-defined type",
  tableTypes: "New table type",
  synonyms: "New synonym",
  triggers: "New trigger",
};

function groupToCreateTarget(
  group: GroupKind,
  db: string,
  schema: string,
): CreateTarget {
  switch (group) {
    case "tables":
      return { kind: "table", db, schema };
    case "views":
      return { kind: "module", moduleKind: "view", db, schema };
    case "procedures":
      return { kind: "module", moduleKind: "proc", db, schema };
    case "functions":
      return { kind: "module", moduleKind: "scalar_fn", db, schema };
    case "sequences":
      return { kind: "sequence", db, schema };
    case "types":
      return { kind: "type", db, schema };
    case "tableTypes":
      return { kind: "tableType", db, schema };
    case "synonyms":
      return { kind: "synonym", db, schema };
    case "triggers":
      return { kind: "module", moduleKind: "trigger", db, schema };
  }
}

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
// lazy-loading each group. All groups always render (even when empty) so users
// see the full SSMS-style category set under each schema.
type GroupKind =
  | "tables"
  | "views"
  | "procedures"
  | "functions"
  | "sequences"
  | "types"
  | "tableTypes"
  | "synonyms"
  | "triggers";

const KIND_TO_GROUP: Record<string, GroupKind> = {
  table: "tables",
  view: "views",
  proc: "procedures",
  scalar_fn: "functions",
  table_fn: "functions",
  sequence: "sequences",
  type: "types",
  table_type: "tableTypes",
  synonym: "synonyms",
  trigger: "triggers",
};

const GROUP_ORDER: GroupKind[] = [
  "tables",
  "views",
  "procedures",
  "functions",
  "sequences",
  "types",
  "tableTypes",
  "synonyms",
  "triggers",
];

const GROUP_LABEL: Record<GroupKind, string> = {
  tables: "Tables",
  views: "Views",
  procedures: "Procedures",
  functions: "Functions",
  sequences: "Sequences",
  types: "User-Defined Types",
  tableTypes: "Table Types",
  synonyms: "Synonyms",
  triggers: "Triggers",
};

// Singular noun used in the context menu (e.g. "Drop {noun}…"). Kept separate
// from GROUP_LABEL because "Table Types" → "table type" doesn't fall out of a
// simple `s` strip.
const GROUP_NOUN: Record<GroupKind, string> = {
  tables: "table",
  views: "view",
  procedures: "procedure",
  functions: "function",
  sequences: "sequence",
  types: "type",
  tableTypes: "table type",
  synonyms: "synonym",
  triggers: "trigger",
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
    case "sequences":
      return <Hash className={className} />;
    case "types":
      return <Shapes className={className} />;
    case "tableTypes":
      return <Boxes className={className} />;
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
    case "sequences":
      return <Hash className={className} />;
    case "types":
      return <Shapes className={className} />;
    case "tableTypes":
      return <Boxes className={className} />;
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
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

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
                  onDrop={() => setDropTarget({ kind: "database", database: db.name })}
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
                        onCreate={(schema, group) =>
                          setCreateTarget(
                            groupToCreateTarget(group, db.name, schema),
                          )
                        }
                        onDrop={setDropTarget}
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
      {createTarget ? (
        <CreateDialogHost
          target={createTarget}
          connectionId={connectionId}
          onClose={() => setCreateTarget(null)}
          onCreated={(t) => {
            // Open the path to the created object so the user sees it
            // appear without hunting for it.
            const groupKey = createTargetGroupKey(t);
            setOpenDb((s) => ({ ...s, [t.db]: true }));
            setOpenSchema((s) => ({ ...s, [`${t.db}.${t.schema}`]: true }));
            setOpenGroup((s) => ({
              ...s,
              [`${t.db}.${t.schema}.${groupKey}`]: true,
            }));
            setObjectsByDb((s) => ({ ...s, [t.db]: undefined }));
            setSchemasByDb((s) => ({ ...s, [t.db]: undefined }));
            loadDb(t.db);
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
            setOpenDb((s) => {
              const next = { ...s };
              delete next[t.database];
              return next;
            });
            refreshAll();
            return;
          }
          // schema or object → reload that database's tree.
          setObjectsByDb((s) => ({ ...s, [t.database]: undefined }));
          setSchemasByDb((s) => ({ ...s, [t.database]: undefined }));
          loadDb(t.database);
        }}
      />
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
  onCreate,
  onDrop,
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
  /** Open the create dialog for any group. The sidebar dispatches by `group`. */
  onCreate: (schema: string, group: GroupKind) => void;
  onDrop: (target: DropTarget) => void;
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
        return (
          <li key={schema}>
            <SchemaRow
              name={schema}
              isOpen={isOpen}
              onToggle={() => onToggleSchema(schema)}
              onCreateTable={() => onCreate(schema, "tables")}
              onDrop={() => onDrop({ kind: "schema", database: db, schema })}
              onCopyName={() => onCopy(schema)}
            />
            {isOpen ? (
              <ul className="ml-4 border-l border-border/50">
                {GROUP_ORDER.map((kind) => {
                  const items = groups.get(kind) ?? [];
                  return (
                    <Group
                      key={kind}
                      kind={kind}
                      items={items}
                      isOpen={!!openGroup[`${key}.${kind}`]}
                      onToggle={() => onToggleGroup(schema, kind)}
                      onCreate={() => onCreate(schema, kind)}
                      createLabel={GROUP_CREATE_LABEL[kind]}
                      renderItem={(o) => (
                        <ObjectRow
                          key={`${kind}:${o.name}`}
                          connectionId={connectionId}
                          db={db}
                          object={o}
                          group={kind}
                          pathname={pathname}
                          onCopy={() => onCopy(`${o.schema}.${o.name}`)}
                          onDrop={() =>
                            onDrop({
                              kind: "object",
                              database: db,
                              schema: o.schema,
                              name: o.name,
                              objectKind: o.kind,
                            })
                          }
                        />
                      )}
                    />
                  );
                })}
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
  onDrop,
  onCopyName,
}: {
  db: DatabaseInfo;
  isOpen: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onCreateSchema: () => void;
  onDrop: () => void;
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

function SchemaRow({
  name,
  isOpen,
  onToggle,
  onCreateTable,
  onDrop,
  onCopyName,
}: {
  name: string;
  isOpen: boolean;
  onToggle: () => void;
  onCreateTable: () => void;
  onDrop: () => void;
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
          <DropdownMenuItem onClick={onCopyName}>Copy name</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDrop}
            className="text-destructive focus:text-destructive"
          >
            Drop schema…
          </DropdownMenuItem>
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
  onCreate,
  createLabel,
  renderItem,
}: {
  kind: GroupKind;
  items: SqlObject[];
  isOpen: boolean;
  onToggle: () => void;
  onCreate?: () => void;
  createLabel?: string;
  renderItem: (item: SqlObject) => React.ReactNode;
}) {
  const isEmpty = items.length === 0;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li>
      <div
        className={cn(
          "group/grp flex items-center pr-1 rounded-md transition-colors",
          isEmpty
            ? "hover:bg-foreground/[0.025]"
            : "hover:bg-foreground/5",
        )}
        onContextMenu={
          onCreate
            ? (e) => {
                e.preventDefault();
                setMenuOpen(true);
              }
            : undefined
        }
      >
        <button
          onClick={isEmpty ? undefined : onToggle}
          disabled={isEmpty}
          className={cn(
            "flex items-center gap-1 flex-1 min-w-0 px-2 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors text-left",
            isEmpty
              ? "text-muted-foreground/40 cursor-default"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              isOpen && !isEmpty && "rotate-90",
              isEmpty && "opacity-50",
            )}
          />
          <span className={cn(isEmpty && "opacity-60")}>{groupIcon(kind)}</span>
          <span className="truncate">{GROUP_LABEL[kind]}</span>
          <span
            className={cn(
              "ml-auto font-mono normal-case tracking-normal text-[10px] tabular-nums",
              isEmpty ? "text-muted-foreground/40" : "text-muted-foreground/70",
            )}
          >
            {items.length}
          </span>
        </button>
        {onCreate ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              onClick={(e) => {
                // Left-click fires create directly (matching the Postgres
                // "+ as primary action" UX). Right-click on the row opens the
                // menu via the wrapping onContextMenu handler.
                e.stopPropagation();
                e.preventDefault();
                onCreate();
              }}
              className="opacity-0 group-hover/grp:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-opacity outline-none"
              title={createLabel ?? "New"}
            >
              <Plus className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onCreate}>
                <Plus className="size-3.5" />
                {createLabel ?? "New"}…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {isOpen && !isEmpty ? (
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
  onDrop,
}: {
  connectionId: string;
  db: string;
  object: SqlObject;
  group: GroupKind;
  pathname: string;
  onCopy: () => void;
  onDrop: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dropNoun = GROUP_NOUN[group];

  // Tables & views → table-detail page; procs / functions / triggers →
  // module-detail page. Synonyms, sequences, and types have no detail view,
  // so they render as muted, non-navigable leaves.
  const base = `/sqlserver/${connectionId}/databases/${encodeURIComponent(db)}`;
  const href =
    group === "tables" || group === "views"
      ? `${base}/tables/${encodeURIComponent(object.schema)}/${encodeURIComponent(object.name)}`
      : group === "synonyms" ||
          group === "sequences" ||
          group === "types" ||
          group === "tableTypes"
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
            title={`${dropNoun} · ${object.schema}.${object.name}`}
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDrop}
                className="text-destructive focus:text-destructive"
              >
                Drop {dropNoun}…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

// ===== Create-dialog host =================================================
//
// All 8 create dialogs are mounted through this single switch. The sidebar's
// SchemaList computes a `CreateTarget` from (schema, GroupKind) — the host
// renders the matching dialog and forwards onCreated with the target intact,
// so the sidebar can expand the right path after creation succeeds.

/** Which GroupKind a freshly-created CreateTarget belongs to in the tree. */
function createTargetGroupKey(t: CreateTarget): GroupKind {
  switch (t.kind) {
    case "table":
      return "tables";
    case "sequence":
      return "sequences";
    case "synonym":
      return "synonyms";
    case "type":
      return "types";
    case "tableType":
      return "tableTypes";
    case "module":
      switch (t.moduleKind) {
        case "view":
          return "views";
        case "proc":
          return "procedures";
        case "scalar_fn":
        case "table_fn":
          return "functions";
        case "trigger":
          return "triggers";
      }
  }
}

function CreateDialogHost({
  target,
  connectionId,
  onClose,
  onCreated,
}: {
  target: CreateTarget;
  connectionId: string;
  onClose: () => void;
  onCreated: (t: CreateTarget) => void;
}) {
  const handleOpenChange = (v: boolean) => {
    if (!v) onClose();
  };
  const handleCreated = () => onCreated(target);
  const common = {
    open: true,
    onOpenChange: handleOpenChange,
    connectionId,
    database: target.db,
    schema: target.schema,
    onCreated: handleCreated,
  } as const;

  switch (target.kind) {
    case "table":
      return <CreateTableDialog {...common} />;
    case "sequence":
      return <CreateSequenceDialog {...common} />;
    case "synonym":
      return <CreateSynonymDialog {...common} />;
    case "type":
      return <CreateTypeDialog {...common} />;
    case "tableType":
      return <CreateTableTypeDialog {...common} />;
    case "module":
      return <CreateModuleDialog {...common} kind={target.moduleKind} />;
  }
}
