"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { ErrorState } from "@/components/workspace/error-state";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { DataPagination } from "@/components/sql/pagination";
import { DataGrid, GridToolbar, filterRows, type GridDensity } from "./data-grid";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DataPage,
  SortState,
  SqlTableDetailDescriptor,
  TabData,
  TableDetailControl,
  TableTab,
} from "./descriptor";

const DEFAULT_LABELS: Record<TableTab, string> = {
  data: "Data",
  structure: "Structure",
  indexes: "Indexes",
  constraints: "Constraints",
  foreign_keys: "Foreign keys",
  ddl: "DDL",
  stats: "Statistics",
};

/**
 * The load key a tab reads from. Under `per-tab` that's the tab itself;
 * under `single` every non-data tab shares one payload, so one failed
 * request means one error and one Retry across all of them.
 */
const META = "meta";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * A header slot. The function form gets the shell's control handle, because
 * the schema these slots describe (SQL Server's row and column counts) and
 * gate on (Postgres' Modify button) now lives inside the shell.
 */
type HeaderSlot = React.ReactNode | ((ctl: TableDetailControl) => React.ReactNode);

function resolveSlot(slot: HeaderSlot, ctl: TableDetailControl): React.ReactNode {
  return typeof slot === "function" ? slot(ctl) : slot;
}

export function SqlTableDetail<TCtx>(props: {
  descriptor: SqlTableDetailDescriptor<TCtx>;
  ctx: TCtx;
  title: HeaderSlot;
  description: HeaderSlot;
  actions?: HeaderSlot;
  onInsertRow?: () => void;
  onEditRow?: (row: Record<string, unknown>) => void;
  onDeleteRow?: (row: Record<string, unknown>) => void;
  /** Dialogs and anything else the client owns, handed the shell's control. */
  children?: (ctl: TableDetailControl) => React.ReactNode;
}): React.ReactElement {
  const {
    descriptor,
    ctx,
    title,
    description,
    actions,
    onInsertRow,
    onEditRow,
    onDeleteRow,
    children,
  } = props;

  // Clients build `descriptor` and `ctx` inside useMemo, so the load
  // callbacks below keep a stable identity across renders. Even if one
  // didn't, the cache / error / in-flight guards mean a re-fired effect
  // issues no extra request — it just re-evaluates and finds nothing to do.
  const base = descriptor.paths.base(ctx);
  const { load } = descriptor;

  const [tab, setTab] = useState<TableTab>(descriptor.tabs[0]);
  const [cache, setCache] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [page, setPage] = useState<DataPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(100);
  const [sort, setSort] = useState<SortState>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [filter, setFilter] = useState("");
  const [density, setDensity] = useState<GridDensity>("compact");

  // Mutable, render-stable containers for the requests in the air. Held via
  // lazy useState rather than useRef because `ctl.reloadData` reads them and
  // the shell hands `ctl` to its children during render — which
  // react-hooks/refs forbids, rightly, for genuine refs.
  const [controllers] = useState(() => new Map<string, AbortController>());
  // In-flight guard. The cache-null + no-error guard alone stays satisfied
  // for as long as a request is in the air, so an unrelated re-render during
  // that window would issue a duplicate — and the characterization suites
  // count requests exactly.
  const [inflight] = useState(() => new Set<string>());

  useEffect(
    () => () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
      inflight.clear();
    },
    [controllers, inflight],
  );

  const sourceOf = useCallback(
    (t: TableTab): string => {
      if (t === "data") return "data";
      return load.strategy === "single" ? META : t;
    },
    [load.strategy],
  );

  const runLoad = useCallback(
    (source: string, forTab: TableTab) => {
      controllers.get(source)?.abort();
      const ac = new AbortController();
      controllers.set(source, ac);
      inflight.add(source);
      const request =
        load.strategy === "single"
          ? load.fetchAll(ctx, ac.signal)
          : load.fetchTab(forTab, ctx, ac.signal);
      request
        .then((payload) => {
          if (ac.signal.aborted) return;
          setCache((prev) => ({ ...prev, [source]: payload }));
        })
        .catch((err) => {
          if (ac.signal.aborted || isAbort(err)) return;
          setErrors((prev) => ({ ...prev, [source]: messageOf(err) }));
        })
        .finally(() => {
          inflight.delete(source);
          if (controllers.get(source) === ac) controllers.delete(source);
        });
    },
    [load, ctx, controllers, inflight],
  );

  const loadPage = useCallback(
    (nextOffset: number, nextLimit: number, nextSort: SortState) => {
      controllers.get("data")?.abort();
      const ac = new AbortController();
      controllers.set("data", ac);
      inflight.add("data");
      setLoadingData(true);
      descriptor.data
        .fetch(ctx, { offset: nextOffset, limit: nextLimit, sort: nextSort }, ac.signal)
        .then((result) => {
          if (ac.signal.aborted) return;
          setPage(result);
          setErrors((prev) => {
            if (!("data" in prev)) return prev;
            const next = { ...prev };
            delete next.data;
            return next;
          });
        })
        .catch((err) => {
          if (ac.signal.aborted || isAbort(err)) return;
          // Null the rows as well as recording the error. Retry only clears
          // the error key and leans on the effect's `page === null` guard to
          // re-fire; leaving a previous page in place would starve that guard
          // forever after a *later* page load fails.
          setPage(null);
          setErrors((prev) => ({ ...prev, data: messageOf(err) }));
        })
        .finally(() => {
          inflight.delete("data");
          if (controllers.get("data") === ac) controllers.delete("data");
          if (!ac.signal.aborted) setLoadingData(false);
        });
    },
    [descriptor.data, ctx, controllers, inflight],
  );

  // Reset when the table itself changes. The functional bail-outs keep the
  // reference stable when there is nothing to clear, so this always-runs
  // effect doesn't hand the load effect below a spurious "change".
  useEffect(() => {
    controllers.forEach((c) => c.abort());
    controllers.clear();
    inflight.clear();
    setCache((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    setPage((prev) => (prev === null ? prev : null));
    setOffset((prev) => (prev === 0 ? prev : 0));
    setSort((prev) => (prev === null ? prev : null));
  }, [base, controllers, inflight]);

  // Schema loads: eager tabs plus whatever the open tab needs.
  useEffect(() => {
    const wanted: TableTab[] = [];
    if (load.strategy === "single") {
      const firstSchemaTab = descriptor.tabs.find((t) => t !== "data");
      if (firstSchemaTab) wanted.push(firstSchemaTab);
    } else {
      wanted.push(...(load.eager ?? []));
      if (tab !== "data") wanted.push(tab);
      wanted.push(...(load.prefetch?.[tab] ?? []));
    }
    for (const t of wanted) {
      const source = sourceOf(t);
      if (cache[source] === undefined && !errors[source] && !inflight.has(source)) {
        runLoad(source, t);
      }
    }
  }, [base, tab, cache, errors, runLoad, sourceOf, load, descriptor.tabs, inflight]);

  // The Data tab's own request. Firing it from the effect rather than from
  // Retry is what keeps the request count exact: Retry clears the error, the
  // guard re-opens, and this fires once.
  useEffect(() => {
    if (tab !== "data") return;
    if (page !== null || errors.data || inflight.has("data")) return;
    loadPage(offset, limit, sort);
  }, [base, tab, page, errors.data, offset, limit, sort, loadPage, inflight]);

  const refresh = useCallback(
    (...tabs: TableTab[]) => {
      const sources = tabs.map(sourceOf);
      if (sources.includes("data")) setPage(null);
      const schemaSources = sources.filter((s) => s !== "data");
      if (schemaSources.length > 0) {
        setCache((prev) => {
          const next = { ...prev };
          for (const s of schemaSources) delete next[s];
          return next;
        });
      }
      setErrors((prev) => {
        if (!sources.some((s) => s in prev)) return prev;
        const next = { ...prev };
        for (const s of sources) delete next[s];
        return next;
      });
    },
    [sourceOf],
  );

  const reloadData = useCallback(
    (nextOffset?: number) => {
      if (nextOffset !== undefined) setOffset(nextOffset);
      loadPage(nextOffset ?? offset, limit, sort);
    },
    [loadPage, offset, limit, sort],
  );

  const all: TabData = useMemo(() => {
    const out: TabData = {};
    for (const t of descriptor.tabs) {
      const value = t === "data" ? page : cache[sourceOf(t)];
      if (value !== undefined && value !== null) out[t] = value;
    }
    return out;
  }, [cache, page, sourceOf, descriptor.tabs]);

  const ctl: TableDetailControl = useMemo(
    () => ({ tab, setTab, all, refresh, reloadData }),
    [tab, all, refresh, reloadData],
  );

  const labelOf = (t: TableTab) => descriptor.labels?.[t] ?? DEFAULT_LABELS[t];
  const errorTitleOf = (t: TableTab) =>
    descriptor.errorTitles?.[t] ?? `Could not load ${labelOf(t).toLowerCase()}`;

  const spec = descriptor.data;
  const filtered = useMemo(
    () => (spec.toolbar ? filterRows(page?.rows ?? [], filter) : (page?.rows ?? [])),
    [spec.toolbar, page, filter],
  );

  const renderArgs = (t: TableTab) => ({ ctx, data: all[t], all, ctl });

  const rowObject = (row: unknown[]): Record<string, unknown> =>
    Object.fromEntries((page?.fields ?? []).map((f, i) => [f.name, row[i]]));

  const rowsMutable = descriptor.rowsMutable?.(all) ?? true;
  const canEdit = descriptor.capabilities.editRow && !!onEditRow && rowsMutable;
  const canDelete = descriptor.capabilities.deleteRow && !!onDeleteRow && rowsMutable;
  // The buttons render whenever the *tech* supports the action — disabled,
  // with readOnlyReason as their title, when this particular table doesn't.
  const rowActionsEnabled =
    descriptor.capabilities.editRow || descriptor.capabilities.deleteRow;

  const insertButton = descriptor.capabilities.insertRow ? (
    <Button
      size="sm"
      onClick={onInsertRow}
      disabled={all[spec.schemaTab] === undefined}
      className={spec.insertClassName}
    >
      <Plus className="size-3.5" />
      Insert row
    </Button>
  ) : null;

  const dataActions = page
    ? spec.actions?.({ ...renderArgs("data"), page, filtered })
    : null;

  const schemaError = errors[sourceOf(spec.schemaTab)];

  function renderDataTab() {
    return (
      <>
        {spec.toolbar ? (
          <GridToolbar
            filter={filter}
            onFilterChange={setFilter}
            density={density}
            onDensityChange={setDensity}
            status={
              <>
                {page?.total != null
                  ? `${page.total.toLocaleString()} rows`
                  : page
                    ? `${page.rows.length} on page`
                    : "…"}
                {page?.rows.length ? ` · ${offset + 1}–${offset + page.rows.length}` : ""}
                {filter.trim()
                  ? ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}`
                  : ""}
              </>
            }
          >
            {dataActions}
            {insertButton}
            <RefreshButton onClick={() => reloadData()} loading={loadingData} />
          </GridToolbar>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {page
                ? `${(page.total ?? page.rows.length).toLocaleString()} row${
                    (page.total ?? page.rows.length) === 1 ? "" : "s"
                  }`
                : "Loading…"}
            </p>
            <div className="flex items-center gap-2">
              {dataActions}
              {insertButton}
            </div>
          </div>
        )}

        {errors.data ? (
          <ErrorState
            title={errorTitleOf("data")}
            message={errors.data}
            onRetry={() => refresh("data")}
          />
        ) : page ? (
          <>
            {schemaError ? (
              <ErrorState
                title="Could not load column metadata"
                message={schemaError}
                onRetry={() => refresh(spec.schemaTab)}
                className="px-3 py-2 mb-3"
              />
            ) : null}
            <DataGrid
              columns={spec.columns(page, all, ctx)}
              rows={filtered}
              density={density}
              sort={spec.sortable ? sort : undefined}
              onToggleSort={spec.sortable ? toggleSort : undefined}
              className={spec.gridClassName}
              rowActions={
                rowActionsEnabled
                  ? (row) => (
                      <>
                        {descriptor.capabilities.editRow ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            disabled={!canEdit}
                            // The accessible name stays "Edit row" even when
                            // disabled — the reason belongs in the tooltip,
                            // not in the button's identity.
                            aria-label="Edit row"
                            title={canEdit ? "Edit row" : descriptor.readOnlyReason}
                            onClick={() => onEditRow?.(rowObject(row))}
                          >
                            <Pencil className="size-3" />
                          </Button>
                        ) : null}
                        {descriptor.capabilities.deleteRow ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6 text-destructive hover:text-destructive"
                            disabled={!canDelete}
                            aria-label="Delete row"
                            title={canDelete ? "Delete row" : descriptor.readOnlyReason}
                            onClick={() => onDeleteRow?.(rowObject(row))}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        ) : null}
                      </>
                    )
                  : undefined
              }
              empty={
                page.rows.length === 0 ? "No rows." : `No rows match “${filter}”.`
              }
            />
          </>
        ) : (
          (descriptor.skeleton?.data ?? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ))
        )}

        {page ? (
          <DataPagination
            offset={offset}
            pageSize={limit}
            total={page.total}
            loading={loadingData}
            onOffsetChange={(next) => {
              setOffset(next);
              loadPage(next, limit, sort);
            }}
            onPageSizeChange={(size) => {
              setLimit(size);
              setOffset(0);
              loadPage(0, size, sort);
            }}
          />
        ) : null}
      </>
    );
  }

  function toggleSort(column: string) {
    const next: SortState =
      !sort || sort.column !== column
        ? { column, dir: "asc" }
        : sort.dir === "asc"
          ? { column, dir: "desc" }
          : null;
    setSort(next);
    setOffset(0);
    loadPage(0, limit, next);
  }

  function renderSchemaTab(t: TableTab) {
    const source = sourceOf(t);
    const error = errors[source];
    const payload = all[t];
    const toolbar = descriptor.toolbar?.[t]?.(renderArgs(t));
    return (
      <>
        {toolbar}
        {error ? (
          <ErrorState
            title={errorTitleOf(t)}
            message={error}
            onRetry={() => refresh(t)}
          />
        ) : payload !== undefined ? (
          descriptor.render[t]?.(renderArgs(t))
        ) : (
          (descriptor.skeleton?.[t] ?? <Skeleton className="h-32 w-full" />)
        )}
      </>
    );
  }

  return (
    <WorkspacePage
      title={resolveSlot(title, ctl)}
      description={resolveSlot(description, ctl)}
      actions={actions === undefined ? undefined : resolveSlot(actions, ctl)}
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TableTab)}
        className="h-full flex flex-col"
        data-tech={descriptor.tech}
      >
        <TabsList>
          {descriptor.tabs.map((t) => (
            <TabsTrigger key={t} value={t}>
              {labelOf(t)}
            </TabsTrigger>
          ))}
        </TabsList>
        {descriptor.tabs.map((t) => (
          <TabsContent
            key={t}
            value={t}
            className={cn("pt-4", descriptor.contentClassName?.[t] ?? "space-y-3")}
          >
            {t === "data" ? renderDataTab() : renderSchemaTab(t)}
          </TabsContent>
        ))}
      </Tabs>
      {children?.(ctl)}
    </WorkspacePage>
  );
}
