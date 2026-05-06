"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Database,
  FileText,
  Folder,
  Table as TableIcon,
  RefreshCcw,
  Loader2,
  Eye,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CreateTableDialog } from "./create-table-dialog";

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

interface Props {
  connectionId: string;
  defaultDatabase: string;
}

export function PostgresSidebar({ connectionId, defaultDatabase }: Props) {
  const pathname = usePathname();
  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [openDb, setOpenDb] = useState<Record<string, boolean>>({
    [defaultDatabase]: true,
  });
  const [schemasByDb, setSchemasByDb] = useState<Record<string, SchemaInfo[]>>(
    {}
  );
  const [openSchema, setOpenSchema] = useState<Record<string, boolean>>({});
  const [objectsBySchema, setObjectsBySchema] = useState<
    Record<string, SchemaObject[]>
  >({});
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createTarget, setCreateTarget] = useState<{
    db: string;
    schema: string;
  } | null>(null);

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
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setSchemasByDb((s) => ({ ...s, [db]: data.schemas as SchemaInfo[] }));
      }
    },
    [connectionId]
  );

  useEffect(() => {
    if (databases && openDb[defaultDatabase] && !schemasByDb[defaultDatabase]) {
      loadSchemas(defaultDatabase);
    }
  }, [databases, defaultDatabase, openDb, schemasByDb, loadSchemas]);

  const loadObjects = useCallback(
    async (db: string, schema: string) => {
      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/objects`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        const key = `${db}.${schema}`;
        setObjectsBySchema((s) => ({
          ...s,
          [key]: data.objects as SchemaObject[],
        }));
      }
    },
    [connectionId]
  );

  const toggleDb = (db: string) => {
    const next = !openDb[db];
    setOpenDb((s) => ({ ...s, [db]: next }));
    if (next && !schemasByDb[db]) loadSchemas(db);
  };

  const toggleSchema = (db: string, schema: string) => {
    const key = `${db}.${schema}`;
    const next = !openSchema[key];
    setOpenSchema((s) => ({ ...s, [key]: next }));
    if (next && !objectsBySchema[key]) loadObjects(db, schema);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Tree
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            setSchemasByDb({});
            setObjectsBySchema({});
            setRefreshKey((n) => n + 1);
          }}
          title="Refresh"
        >
          {loadingDbs ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCcw className="size-3" />
          )}
        </Button>
      </div>

      {databases === null ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
      ) : (
        <ul>
          {databases.map((db) => (
            <li key={db.name}>
              <button
                onClick={() => toggleDb(db.name)}
                className="flex items-center gap-1 w-full px-2 py-1 rounded-md text-sm hover:bg-foreground/5 transition-colors text-left"
              >
                <ChevronRight
                  className={cn(
                    "size-3 text-muted-foreground transition-transform",
                    openDb[db.name] && "rotate-90"
                  )}
                />
                <Database className="size-3.5 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{db.name}</span>
              </button>
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
                      const isOpen = openSchema[key];
                      return (
                        <li key={schema.name}>
                          <div className="group/schema-row flex items-center pr-1 rounded-md hover:bg-foreground/5 transition-colors">
                            <button
                              onClick={() =>
                                toggleSchema(db.name, schema.name)
                              }
                              className="flex items-center gap-1 flex-1 min-w-0 px-2 py-1 text-sm text-left"
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3 text-muted-foreground transition-transform",
                                  isOpen && "rotate-90"
                                )}
                              />
                              <Folder className="size-3.5 text-muted-foreground" />
                              <span className="truncate font-mono text-xs">
                                {schema.name}
                              </span>
                            </button>
                            <button
                              onClick={() =>
                                setCreateTarget({
                                  db: db.name,
                                  schema: schema.name,
                                })
                              }
                              className="opacity-0 group-hover/schema-row:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-opacity"
                              title={`New table in ${schema.name}`}
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                          {isOpen ? (
                            <ul className="ml-4 border-l border-border/50">
                              {!objectsBySchema[key] ? (
                                <li className="px-2 py-1 text-xs text-muted-foreground">
                                  Loading…
                                </li>
                              ) : objectsBySchema[key].length === 0 ? (
                                <li className="px-2 py-1 text-xs text-muted-foreground">
                                  (empty)
                                </li>
                              ) : (
                                objectsBySchema[key].map((obj) => {
                                  const href = `/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/schemas/${encodeURIComponent(schema.name)}/tables/${encodeURIComponent(obj.name)}`;
                                  const active = pathname.startsWith(href);
                                  const Icon =
                                    obj.kind === "view" ||
                                    obj.kind === "materialized_view"
                                      ? Eye
                                      : obj.kind === "table"
                                        ? TableIcon
                                        : FileText;
                                  return (
                                    <li key={obj.name}>
                                      <Link
                                        href={href}
                                        className={cn(
                                          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors font-mono",
                                          active
                                            ? "bg-foreground/10 text-foreground font-medium"
                                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                                        )}
                                      >
                                        <Icon className="size-3 shrink-0" />
                                        <span className="truncate">
                                          {obj.name}
                                        </span>
                                      </Link>
                                    </li>
                                  );
                                })
                              )}
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
                        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono transition-colors",
                        pathname ===
                          `/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/query`
                          ? "bg-foreground/10 text-foreground font-medium"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
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

      {createTarget ? (
        <CreateTableDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setCreateTarget(null);
          }}
          connectionId={connectionId}
          database={createTarget.db}
          schema={createTarget.schema}
          onCreated={() => {
            const t = createTarget;
            if (!t) return;
            setOpenDb((s) => ({ ...s, [t.db]: true }));
            setOpenSchema((s) => ({ ...s, [`${t.db}.${t.schema}`]: true }));
            loadObjects(t.db, t.schema);
          }}
        />
      ) : null}
    </div>
  );
}
