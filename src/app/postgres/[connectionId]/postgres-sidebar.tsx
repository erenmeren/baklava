"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Database,
  FileCode,
  FileText,
  Folder,
  Hash,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Server,
  Shield,
  Table as TableIcon,
  Eye,
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
import { CreateTableDialog } from "./create-table-dialog";
import { CreateSchemaDialog } from "./create-schema-dialog";
import { CreateDatabaseDialog } from "./create-database-dialog";
import {
  SequenceFormDialog,
  type SequenceFormSeed,
} from "./sequence-form-dialog";
import { FunctionEditorDialog } from "./function-editor-dialog";
import { ViewEditorDialog } from "./view-editor-dialog";
import { DropConfirm, type DropTarget } from "./drop-confirm";
import { DDLDialog } from "./ddl-dialog";
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
  owner: string;
  encoding: string;
  size: number;
}

interface SchemaInfo {
  name: string;
  owner: string;
}

interface SchemaObject {
  name: string;
  kind: "table" | "view" | "materialized_view";
  rowEstimate: number;
}

interface FunctionInfo {
  name: string;
  language: string;
  returnType: string;
  arguments: string;
  kind: "function" | "procedure" | "aggregate" | "window";
}

interface SequenceInfo {
  name: string;
  dataType: string;
  startValue: string;
  minValue: string;
  maxValue: string;
  increment: string;
  lastValue: string | null;
}

type GroupKind = "tables" | "views" | "functions" | "sequences";

interface SchemaGroups {
  tables: SchemaObject[] | null;
  views: SchemaObject[] | null;
  functions: FunctionInfo[] | null;
  sequences: SequenceInfo[] | null;
}

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

const EMPTY_GROUPS: SchemaGroups = {
  tables: null,
  views: null,
  functions: null,
  sequences: null,
};

export function PostgresSidebar({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname();

  // ----- Tree state ---------------------------------------------------------

  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [openDb, setOpenDb] = useState<Record<string, boolean>>({
    [defaultDatabase]: true,
  });
  const [schemasByDb, setSchemasByDb] = useState<Record<string, SchemaInfo[]>>({});
  const [openSchema, setOpenSchema] = useState<Record<string, boolean>>({});
  const [groupsBySchema, setGroupsBySchema] = useState<
    Record<string, SchemaGroups>
  >({});
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({});

  const [loadingDbs, setLoadingDbs] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // ----- Dialog state -------------------------------------------------------

  const [createTableTarget, setCreateTableTarget] = useState<{
    db: string;
    schema: string;
  } | null>(null);
  const [createSchemaTarget, setCreateSchemaTarget] = useState<string | null>(
    null,
  );
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [seqDialog, setSeqDialog] = useState<
    | { mode: "create"; db: string; schema: string }
    | { mode: "edit"; db: string; schema: string; initial: SequenceFormSeed }
    | null
  >(null);
  const [fnDialog, setFnDialog] = useState<
    | { mode: "create"; db: string; schema: string }
    | { mode: "edit"; db: string; schema: string; name: string; args: string }
    | null
  >(null);
  const [viewDialog, setViewDialog] = useState<
    | { mode: "create"; db: string; schema: string }
    | { mode: "edit"; db: string; schema: string; name: string }
    | null
  >(null);
  const [dropViewTarget, setDropViewTarget] = useState<{
    db: string;
    schema: string;
    name: string;
    materialized: boolean;
  } | null>(null);
  const [dropFnTarget, setDropFnTarget] = useState<{
    db: string;
    schema: string;
    name: string;
    args: string;
    kind: "function" | "procedure" | "aggregate" | "window";
  } | null>(null);
  const [dropSeqTarget, setDropSeqTarget] = useState<{
    db: string;
    schema: string;
    name: string;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ddlTarget, setDdlTarget] = useState<{
    title: string;
    fetchUrl: string;
    payloadKey: "ddl" | "definition";
    prefix?: string;
  } | null>(null);

  // ----- Data loaders -------------------------------------------------------

  const loadDatabases = useCallback(async () => {
    setLoadingDbs(true);
    try {
      const res = await fetch(`/api/postgres/${connectionId}/databases`, {
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

  const loadSchemas = useCallback(
    async (db: string) => {
      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setSchemasByDb((s) => ({ ...s, [db]: data.schemas as SchemaInfo[] }));
      }
    },
    [connectionId],
  );

  useEffect(() => {
    if (databases && openDb[defaultDatabase] && !schemasByDb[defaultDatabase]) {
      loadSchemas(defaultDatabase);
    }
  }, [databases, defaultDatabase, openDb, schemasByDb, loadSchemas]);

  const loadGroup = useCallback(
    async (db: string, schema: string, kind: GroupKind) => {
      const url =
        kind === "tables"
          ? `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/objects`
          : kind === "views"
            ? `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/objects`
            : `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/${kind}`;

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const key = `${db}.${schema}`;
      setGroupsBySchema((s) => {
        const cur = s[key] ?? EMPTY_GROUPS;
        if (kind === "tables") {
          const objs = (data.objects as SchemaObject[]) ?? [];
          return {
            ...s,
            [key]: {
              ...cur,
              tables: objs.filter((o) => o.kind === "table"),
              // /objects also gives us views — opportunistically populate
              views:
                cur.views ??
                objs.filter(
                  (o) => o.kind === "view" || o.kind === "materialized_view",
                ),
            },
          };
        }
        if (kind === "views") {
          const objs = (data.objects as SchemaObject[]) ?? [];
          return {
            ...s,
            [key]: {
              ...cur,
              views: objs.filter(
                (o) => o.kind === "view" || o.kind === "materialized_view",
              ),
              tables: cur.tables ?? objs.filter((o) => o.kind === "table"),
            },
          };
        }
        if (kind === "functions") {
          return {
            ...s,
            [key]: { ...cur, functions: data.functions as FunctionInfo[] },
          };
        }
        return {
          ...s,
          [key]: { ...cur, sequences: data.sequences as SequenceInfo[] },
        };
      });
    },
    [connectionId],
  );

  const reloadSchemaContents = useCallback(
    (db: string, schema: string) => {
      const key = `${db}.${schema}`;
      // Refetch whatever groups are currently open.
      const openKinds: GroupKind[] = (
        ["tables", "views", "functions", "sequences"] as const
      ).filter((k) => openGroup[`${key}.${k}`]);
      // Also clear cached
      setGroupsBySchema((s) => ({ ...s, [key]: EMPTY_GROUPS }));
      for (const k of openKinds) loadGroup(db, schema, k);
    },
    [openGroup, loadGroup],
  );

  // ----- Toggles ------------------------------------------------------------

  const toggleDb = (db: string) => {
    const next = !openDb[db];
    setOpenDb((s) => ({ ...s, [db]: next }));
    if (next && !schemasByDb[db]) loadSchemas(db);
  };

  const toggleSchema = (db: string, schema: string) => {
    const key = `${db}.${schema}`;
    const next = !openSchema[key];
    setOpenSchema((s) => ({ ...s, [key]: next }));
    if (next) {
      // Auto-open the Tables group on first expansion.
      const tk = `${key}.tables`;
      setOpenGroup((s) => ({ ...s, [tk]: true }));
      if (!groupsBySchema[key]?.tables) loadGroup(db, schema, "tables");
    }
  };

  const toggleGroup = (db: string, schema: string, kind: GroupKind) => {
    const key = `${db}.${schema}`;
    const gk = `${key}.${kind}`;
    const next = !openGroup[gk];
    setOpenGroup((s) => ({ ...s, [gk]: next }));
    if (next && !groupsBySchema[key]?.[kind]) loadGroup(db, schema, kind);
  };

  // ----- Actions ------------------------------------------------------------

  const refreshAll = () => {
    setSchemasByDb({});
    setGroupsBySchema({});
    setRefreshKey((n) => n + 1);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const openTableDDL = (db: string, schema: string, table: string) => {
    setDdlTarget({
      title: `${schema}.${table}`,
      fetchUrl: `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}?view=ddl`,
      payloadKey: "ddl",
    });
  };

  // ----- Render -------------------------------------------------------------

  const rolesHref = `/postgres/${connectionId}/roles`;
  const rolesActive = pathname === rolesHref;

  return (
    <div className="space-y-1 select-none">
      <div className="px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Server className="size-3" />
          Server
        </span>
      </div>
      <Link
        href={rolesHref}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 ml-2 rounded-md text-xs font-mono transition-colors",
          rolesActive
            ? "bg-foreground/10 text-foreground font-medium"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <Shield className="size-3 shrink-0" />
        <span className="truncate">Roles</span>
      </Link>

      <div className="flex items-center justify-between px-2 pt-3 pb-1">
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
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={refreshAll}
            title="Refresh"
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
      ) : (
        <ul>
          {databases.map((db) => (
            <li key={db.name}>
              <DatabaseRow
                db={db}
                isOpen={!!openDb[db.name]}
                onToggle={() => toggleDb(db.name)}
                onCreateSchema={() => setCreateSchemaTarget(db.name)}
                onRefresh={() => {
                  setSchemasByDb((s) => ({ ...s, [db.name]: undefined as unknown as SchemaInfo[] }));
                  loadSchemas(db.name);
                }}
                onDrop={() =>
                  setDropTarget({ kind: "database", database: db.name })
                }
                onOpenSqlEditor={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/query`}
              />
              {openDb[db.name] ? (
                <ul className="ml-4 border-l border-border/50">
                  {!schemasByDb[db.name] ? (
                    <li className="px-2 py-1 text-xs text-muted-foreground">
                      Loading…
                    </li>
                  ) : schemasByDb[db.name].length === 0 ? (
                    <li className="px-2 py-1 text-xs text-muted-foreground">
                      (no schemas)
                    </li>
                  ) : (
                    schemasByDb[db.name].map((schema) => {
                      const key = `${db.name}.${schema.name}`;
                      const isOpen = !!openSchema[key];
                      const groups = groupsBySchema[key] ?? EMPTY_GROUPS;
                      return (
                        <li key={schema.name}>
                          <SchemaRow
                            schema={schema}
                            isOpen={isOpen}
                            onToggle={() => toggleSchema(db.name, schema.name)}
                            onCreateTable={() =>
                              setCreateTableTarget({
                                db: db.name,
                                schema: schema.name,
                              })
                            }
                            onRefresh={() =>
                              reloadSchemaContents(db.name, schema.name)
                            }
                            onDrop={() =>
                              setDropTarget({
                                kind: "schema",
                                database: db.name,
                                schema: schema.name,
                              })
                            }
                            onCopyName={() => copy(schema.name)}
                          />
                          {isOpen ? (
                            <ul className="ml-4 border-l border-border/50">
                              <Group
                                kind="tables"
                                label="Tables"
                                icon={
                                  <TableIcon className="size-3 text-muted-foreground" />
                                }
                                items={groups.tables}
                                openKey={`${key}.tables`}
                                openMap={openGroup}
                                onToggle={() =>
                                  toggleGroup(db.name, schema.name, "tables")
                                }
                                onCreate={() =>
                                  setCreateTableTarget({
                                    db: db.name,
                                    schema: schema.name,
                                  })
                                }
                                createLabel="New table"
                                renderItem={(t) => (
                                  <ObjectRow
                                    key={t.name}
                                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/tables/${encodeURIComponent(t.name)}`}
                                    name={t.name}
                                    pathname={pathname}
                                    icon={
                                      <TableIcon className="size-3 shrink-0" />
                                    }
                                    menuItems={
                                      <>
                                        <DropdownMenuItem
                                          onClick={() =>
                                            openTableDDL(
                                              db.name,
                                              schema.name,
                                              t.name,
                                            )
                                          }
                                        >
                                          View DDL
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() =>
                                            copy(`${schema.name}.${t.name}`)
                                          }
                                        >
                                          Copy name
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() =>
                                            setDropTarget({
                                              kind: "table",
                                              database: db.name,
                                              schema: schema.name,
                                              name: t.name,
                                            })
                                          }
                                          className="text-destructive focus:text-destructive"
                                        >
                                          Drop table…
                                        </DropdownMenuItem>
                                      </>
                                    }
                                  />
                                )}
                              />
                              <Group
                                kind="views"
                                label="Views"
                                icon={
                                  <Eye className="size-3 text-muted-foreground" />
                                }
                                items={groups.views}
                                openKey={`${key}.views`}
                                openMap={openGroup}
                                onToggle={() =>
                                  toggleGroup(db.name, schema.name, "views")
                                }
                                onCreate={() =>
                                  setViewDialog({
                                    mode: "create",
                                    db: db.name,
                                    schema: schema.name,
                                  })
                                }
                                createLabel="New view"
                                renderItem={(v) => {
                                  const isMatView =
                                    v.kind === "materialized_view";
                                  return (
                                    <ObjectRow
                                      key={v.name}
                                      href={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/tables/${encodeURIComponent(v.name)}`}
                                      name={v.name}
                                      pathname={pathname}
                                      icon={
                                        <Eye className="size-3 shrink-0" />
                                      }
                                      menuItems={
                                        <>
                                          <DropdownMenuItem
                                            onClick={() =>
                                              setDdlTarget({
                                                title: `${schema.name}.${v.name}`,
                                                fetchUrl: `/api/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/views/${encodeURIComponent(v.name)}`,
                                                payloadKey: "definition",
                                                prefix: `CREATE OR REPLACE ${isMatView ? "MATERIALIZED " : ""}VIEW ${schema.name}.${v.name} AS\n`,
                                              })
                                            }
                                          >
                                            View DDL
                                          </DropdownMenuItem>
                                          {!isMatView ? (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                setViewDialog({
                                                  mode: "edit",
                                                  db: db.name,
                                                  schema: schema.name,
                                                  name: v.name,
                                                })
                                              }
                                            >
                                              Edit…
                                            </DropdownMenuItem>
                                          ) : null}
                                          <DropdownMenuItem
                                            onClick={() =>
                                              copy(`${schema.name}.${v.name}`)
                                            }
                                          >
                                            Copy name
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onClick={() =>
                                              setDropViewTarget({
                                                db: db.name,
                                                schema: schema.name,
                                                name: v.name,
                                                materialized: isMatView,
                                              })
                                            }
                                            className="text-destructive focus:text-destructive"
                                          >
                                            Drop {isMatView ? "materialized view" : "view"}…
                                          </DropdownMenuItem>
                                        </>
                                      }
                                    />
                                  );
                                }}
                              />
                              <Group
                                kind="functions"
                                label="Functions"
                                icon={
                                  <FileCode className="size-3 text-muted-foreground" />
                                }
                                items={groups.functions}
                                openKey={`${key}.functions`}
                                openMap={openGroup}
                                onToggle={() =>
                                  toggleGroup(db.name, schema.name, "functions")
                                }
                                onCreate={() =>
                                  setFnDialog({
                                    mode: "create",
                                    db: db.name,
                                    schema: schema.name,
                                  })
                                }
                                createLabel="New function"
                                renderItem={(f) => (
                                  <FunctionRow
                                    key={`${f.name}(${f.arguments})`}
                                    fn={f}
                                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/functions/${encodeURIComponent(f.name)}?args=${encodeURIComponent(f.arguments)}`}
                                    pathname={pathname}
                                    onCopy={() =>
                                      copy(`${schema.name}.${f.name}`)
                                    }
                                    onViewDDL={() =>
                                      setDdlTarget({
                                        title: `${schema.name}.${f.name}(${f.arguments})`,
                                        fetchUrl: `/api/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/functions/${encodeURIComponent(f.name)}?args=${encodeURIComponent(f.arguments)}`,
                                        payloadKey: "definition",
                                      })
                                    }
                                    onEdit={() =>
                                      setFnDialog({
                                        mode: "edit",
                                        db: db.name,
                                        schema: schema.name,
                                        name: f.name,
                                        args: f.arguments,
                                      })
                                    }
                                    onDrop={() =>
                                      setDropFnTarget({
                                        db: db.name,
                                        schema: schema.name,
                                        name: f.name,
                                        args: f.arguments,
                                        kind: f.kind,
                                      })
                                    }
                                  />
                                )}
                              />
                              <Group
                                kind="sequences"
                                label="Sequences"
                                icon={
                                  <Hash className="size-3 text-muted-foreground" />
                                }
                                items={groups.sequences}
                                openKey={`${key}.sequences`}
                                openMap={openGroup}
                                onToggle={() =>
                                  toggleGroup(db.name, schema.name, "sequences")
                                }
                                onCreate={() =>
                                  setSeqDialog({
                                    mode: "create",
                                    db: db.name,
                                    schema: schema.name,
                                  })
                                }
                                createLabel="New sequence"
                                renderItem={(s) => (
                                  <SequenceRow
                                    key={s.name}
                                    seq={s}
                                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/sequences/${encodeURIComponent(s.name)}`}
                                    pathname={pathname}
                                    onCopy={() =>
                                      copy(`${schema.name}.${s.name}`)
                                    }
                                    onEdit={() =>
                                      setSeqDialog({
                                        mode: "edit",
                                        db: db.name,
                                        schema: schema.name,
                                        initial: {
                                          name: s.name,
                                          start: s.startValue,
                                          increment: s.increment,
                                          minValue: s.minValue,
                                          maxValue: s.maxValue,
                                          cache: "1",
                                          cycle: false,
                                        },
                                      })
                                    }
                                    onDrop={() =>
                                      setDropSeqTarget({
                                        db: db.name,
                                        schema: schema.name,
                                        name: s.name,
                                      })
                                    }
                                  />
                                )}
                              />
                            </ul>
                          ) : null}
                        </li>
                      );
                    })
                  )}
                  <li>
                    <Link
                      href={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/query`}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 mt-1 rounded-md text-xs font-mono transition-colors",
                        pathname ===
                          `/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/query`
                          ? "bg-foreground/10 text-foreground font-medium"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                      )}
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">SQL editor</span>
                    </Link>
                  </li>
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Dialogs */}
      {createTableTarget ? (
        <CreateTableDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setCreateTableTarget(null);
          }}
          connectionId={connectionId}
          database={createTableTarget.db}
          schema={createTableTarget.schema}
          onCreated={() => {
            const t = createTableTarget;
            if (!t) return;
            const key = `${t.db}.${t.schema}`;
            setOpenDb((s) => ({ ...s, [t.db]: true }));
            setOpenSchema((s) => ({ ...s, [key]: true }));
            setOpenGroup((s) => ({ ...s, [`${key}.tables`]: true }));
            loadGroup(t.db, t.schema, "tables");
          }}
        />
      ) : null}

      <CreateDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        connectionId={connectionId}
        onCreated={() => {
          setRefreshKey((n) => n + 1);
        }}
      />

      {seqDialog ? (
        seqDialog.mode === "create" ? (
          <SequenceFormDialog
            mode="create"
            open={true}
            onOpenChange={(v) => {
              if (!v) setSeqDialog(null);
            }}
            connectionId={connectionId}
            database={seqDialog.db}
            schema={seqDialog.schema}
            onSuccess={() => {
              const key = `${seqDialog.db}.${seqDialog.schema}`;
              setOpenGroup((s) => ({ ...s, [`${key}.sequences`]: true }));
              loadGroup(seqDialog.db, seqDialog.schema, "sequences");
            }}
          />
        ) : (
          <SequenceFormDialog
            mode="edit"
            open={true}
            onOpenChange={(v) => {
              if (!v) setSeqDialog(null);
            }}
            connectionId={connectionId}
            database={seqDialog.db}
            schema={seqDialog.schema}
            initial={seqDialog.initial}
            onSuccess={() =>
              loadGroup(seqDialog.db, seqDialog.schema, "sequences")
            }
          />
        )
      ) : null}

      {viewDialog ? (
        viewDialog.mode === "create" ? (
          <ViewEditorDialog
            mode="create"
            open={true}
            onOpenChange={(v) => {
              if (!v) setViewDialog(null);
            }}
            connectionId={connectionId}
            database={viewDialog.db}
            schema={viewDialog.schema}
            onSuccess={() => {
              const key = `${viewDialog.db}.${viewDialog.schema}`;
              setOpenGroup((s) => ({ ...s, [`${key}.views`]: true }));
              loadGroup(viewDialog.db, viewDialog.schema, "views");
            }}
          />
        ) : (
          <ViewEditorDialog
            mode="edit"
            open={true}
            onOpenChange={(v) => {
              if (!v) setViewDialog(null);
            }}
            connectionId={connectionId}
            database={viewDialog.db}
            schema={viewDialog.schema}
            name={viewDialog.name}
            onSuccess={() =>
              loadGroup(viewDialog.db, viewDialog.schema, "views")
            }
          />
        )
      ) : null}

      <AlertDialog
        open={dropViewTarget !== null}
        onOpenChange={(v) => {
          if (!v && !working) setDropViewTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop {dropViewTarget?.materialized ? "materialized view" : "view"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dropViewTarget ? (
                <>
                  This will run{" "}
                  <span className="font-mono">
                    DROP{" "}
                    {dropViewTarget.materialized ? "MATERIALIZED VIEW" : "VIEW"}{" "}
                    {dropViewTarget.schema}.{dropViewTarget.name}
                  </span>
                  . This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!dropViewTarget) return;
                setWorking(true);
                try {
                  const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(dropViewTarget.db)}/schemas/${encodeURIComponent(dropViewTarget.schema)}/views/${encodeURIComponent(dropViewTarget.name)}?materialized=${dropViewTarget.materialized}`;
                  const res = await fetch(url, { method: "DELETE" });
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Drop failed", { description: data.error });
                  } else {
                    toast.success(
                      `Dropped ${dropViewTarget.schema}.${dropViewTarget.name}`,
                    );
                    loadGroup(dropViewTarget.db, dropViewTarget.schema, "views");
                    setDropViewTarget(null);
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

      {fnDialog ? (
        fnDialog.mode === "create" ? (
          <FunctionEditorDialog
            mode="create"
            open={true}
            onOpenChange={(v) => {
              if (!v) setFnDialog(null);
            }}
            connectionId={connectionId}
            database={fnDialog.db}
            schema={fnDialog.schema}
            onSuccess={() => {
              const key = `${fnDialog.db}.${fnDialog.schema}`;
              setOpenGroup((s) => ({ ...s, [`${key}.functions`]: true }));
              loadGroup(fnDialog.db, fnDialog.schema, "functions");
            }}
          />
        ) : (
          <FunctionEditorDialog
            mode="edit"
            open={true}
            onOpenChange={(v) => {
              if (!v) setFnDialog(null);
            }}
            connectionId={connectionId}
            database={fnDialog.db}
            schema={fnDialog.schema}
            name={fnDialog.name}
            argSignature={fnDialog.args}
            onSuccess={() =>
              loadGroup(fnDialog.db, fnDialog.schema, "functions")
            }
          />
        )
      ) : null}

      <AlertDialog
        open={dropFnTarget !== null}
        onOpenChange={(v) => {
          if (!v && !working) setDropFnTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop {dropFnTarget?.kind === "procedure" ? "procedure" : "function"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dropFnTarget ? (
                <>
                  This will run{" "}
                  <span className="font-mono">
                    DROP {dropFnTarget.kind === "procedure" ? "PROCEDURE" : "FUNCTION"}{" "}
                    {dropFnTarget.schema}.{dropFnTarget.name}({dropFnTarget.args})
                  </span>
                  . This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!dropFnTarget) return;
                setWorking(true);
                try {
                  const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(dropFnTarget.db)}/schemas/${encodeURIComponent(dropFnTarget.schema)}/functions/${encodeURIComponent(dropFnTarget.name)}?args=${encodeURIComponent(dropFnTarget.args)}&kind=${dropFnTarget.kind === "procedure" ? "procedure" : "function"}`;
                  const res = await fetch(url, { method: "DELETE" });
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Drop failed", { description: data.error });
                  } else {
                    toast.success(
                      `Dropped ${dropFnTarget.schema}.${dropFnTarget.name}`,
                    );
                    loadGroup(dropFnTarget.db, dropFnTarget.schema, "functions");
                    setDropFnTarget(null);
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

      <AlertDialog
        open={dropSeqTarget !== null}
        onOpenChange={(v) => {
          if (!v && !working) setDropSeqTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop sequence?</AlertDialogTitle>
            <AlertDialogDescription>
              {dropSeqTarget ? (
                <>
                  This will run{" "}
                  <span className="font-mono">
                    DROP SEQUENCE {dropSeqTarget.schema}.{dropSeqTarget.name}
                  </span>
                  . Owned columns will lose their default; this cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!dropSeqTarget) return;
                setWorking(true);
                try {
                  const url = `/api/postgres/${connectionId}/databases/${encodeURIComponent(dropSeqTarget.db)}/schemas/${encodeURIComponent(dropSeqTarget.schema)}/sequences/${encodeURIComponent(dropSeqTarget.name)}`;
                  const res = await fetch(url, { method: "DELETE" });
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Drop failed", { description: data.error });
                  } else {
                    toast.success(
                      `Dropped ${dropSeqTarget.schema}.${dropSeqTarget.name}`,
                    );
                    loadGroup(dropSeqTarget.db, dropSeqTarget.schema, "sequences");
                    setDropSeqTarget(null);
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

      {createSchemaTarget ? (
        <CreateSchemaDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setCreateSchemaTarget(null);
          }}
          connectionId={connectionId}
          database={createSchemaTarget}
          onCreated={() => {
            const db = createSchemaTarget;
            if (!db) return;
            setOpenDb((s) => ({ ...s, [db]: true }));
            loadSchemas(db);
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
          if (t.kind === "schema") {
            // Reload schema list for that database.
            loadSchemas(t.database);
            const key = `${t.database}.${t.schema}`;
            setOpenSchema((s) => {
              const next = { ...s };
              delete next[key];
              return next;
            });
            setGroupsBySchema((s) => {
              const next = { ...s };
              delete next[key];
              return next;
            });
          } else {
            // Reload that schema's tables.
            loadGroup(t.database, t.schema, "tables");
          }
        }}
      />

      {ddlTarget ? (
        <DDLDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setDdlTarget(null);
          }}
          title={ddlTarget.title}
          description="generated DDL"
          fetchUrl={ddlTarget.fetchUrl}
          payloadKey={ddlTarget.payloadKey}
          prefix={ddlTarget.prefix}
        />
      ) : null}
    </div>
  );
}

// ===== Sub-components =======================================================

function DatabaseRow({
  db,
  isOpen,
  onToggle,
  onCreateSchema,
  onRefresh,
  onDrop,
  onOpenSqlEditor,
}: {
  db: DatabaseInfo;
  isOpen: boolean;
  onToggle: () => void;
  onCreateSchema: () => void;
  onRefresh: () => void;
  onDrop: () => void;
  onOpenSqlEditor: string;
}) {
  const router = useRouter();
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
          <DropdownMenuItem onClick={onCreateSchema}>
            <Plus className="size-3.5" />
            New schema…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(onOpenSqlEditor)}>
            <FileText className="size-3.5" />
            Open SQL editor
          </DropdownMenuItem>
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

function SchemaRow({
  schema,
  isOpen,
  onToggle,
  onCreateTable,
  onRefresh,
  onDrop,
  onCopyName,
}: {
  schema: SchemaInfo;
  isOpen: boolean;
  onToggle: () => void;
  onCreateTable: () => void;
  onRefresh: () => void;
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
        <span className="truncate font-mono text-xs">{schema.name}</span>
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
          <DropdownMenuItem onClick={onRefresh}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </DropdownMenuItem>
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

function Group<T>({
  label,
  icon,
  items,
  openKey,
  openMap,
  onToggle,
  onCreate,
  createLabel,
  renderItem,
}: {
  kind: GroupKind;
  label: string;
  icon: React.ReactNode;
  items: T[] | null;
  openKey: string;
  openMap: Record<string, boolean>;
  onToggle: () => void;
  onCreate?: () => void;
  createLabel?: string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const isOpen = !!openMap[openKey];
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li>
      <div
        className="group/grp flex items-center pr-1 rounded-md hover:bg-foreground/5 transition-colors"
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
          onClick={onToggle}
          className="flex items-center gap-1 flex-1 min-w-0 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          {icon}
          <span>{label}</span>
          {items ? (
            <span className="ml-auto font-mono normal-case tracking-normal text-[10px] text-muted-foreground/70">
              {items.length}
            </span>
          ) : null}
        </button>
        {onCreate ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              onClick={(e) => {
                // Left-click on the trigger fires the primary action directly,
                // matching the previous "+ shortcut" UX. Right-click opens the
                // menu via the wrapping div's onContextMenu handler.
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
      {isOpen ? (
        <ul className="ml-4 border-l border-border/40">
          {items === null ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Loading…</li>
          ) : items.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-muted-foreground/70 italic">
              none
            </li>
          ) : (
            items.map((item) => renderItem(item))
          )}
        </ul>
      ) : null}
    </li>
  );
}

function ObjectRow({
  href,
  name,
  pathname,
  icon,
  menuItems,
}: {
  href: string;
  name: string;
  pathname: string;
  icon: React.ReactNode;
  menuItems: React.ReactNode;
}) {
  const active = pathname.startsWith(href);
  const [menuOpen, setMenuOpen] = useState(false);
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
          {icon}
          <span className="truncate">{name}</span>
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
            <DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

function FunctionRow({
  fn,
  href,
  pathname,
  onCopy,
  onViewDDL,
  onEdit,
  onDrop,
}: {
  fn: FunctionInfo;
  href: string;
  pathname: string;
  onCopy: () => void;
  onViewDDL: () => void;
  onEdit: () => void;
  onDrop: () => void;
}) {
  const signature = fn.arguments
    ? `${fn.name}(${fn.arguments.length > 40 ? fn.arguments.slice(0, 38) + "…" : fn.arguments})`
    : `${fn.name}()`;
  const tooltip = `${fn.kind} · ${fn.language}\n${fn.name}(${fn.arguments}) → ${fn.returnType}`;
  const isEditable = fn.kind === "function" || fn.kind === "procedure";
  const [menuOpen, setMenuOpen] = useState(false);
  const active = pathname === href.split("?")[0];
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
            "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs font-mono",
            active ? "text-foreground font-medium" : "text-muted-foreground",
          )}
          title={tooltip}
        >
          <FileCode className="size-3 shrink-0" />
          <span className="truncate">{signature}</span>
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
              <DropdownMenuItem onClick={onViewDDL}>View DDL</DropdownMenuItem>
              {isEditable ? (
                <DropdownMenuItem onClick={onEdit}>Edit…</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={onCopy}>Copy name</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDrop}
                className="text-destructive focus:text-destructive"
              >
                Drop {fn.kind === "procedure" ? "procedure" : "function"}…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

function SequenceRow({
  seq,
  href,
  pathname,
  onCopy,
  onEdit,
  onDrop,
}: {
  seq: SequenceInfo;
  href: string;
  pathname: string;
  onCopy: () => void;
  onEdit: () => void;
  onDrop: () => void;
}) {
  const tooltip = `${seq.dataType} · last ${seq.lastValue ?? "—"}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const active = pathname === href;
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
            "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs font-mono",
            active ? "text-foreground font-medium" : "text-muted-foreground",
          )}
          title={tooltip}
        >
          <Hash className="size-3 shrink-0" />
          <span className="truncate">{seq.name}</span>
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
              <DropdownMenuItem onClick={onEdit}>Edit…</DropdownMenuItem>
              <DropdownMenuItem onClick={onCopy}>Copy name</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDrop}
                className="text-destructive focus:text-destructive"
              >
                Drop sequence…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
