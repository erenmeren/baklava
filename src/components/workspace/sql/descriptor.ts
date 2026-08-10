import type React from "react";
import type { TechId } from "@/lib/connections/types";
import type { GridColumn } from "./data-grid";

/**
 * Every tab any SQL table-detail workspace can show. A tech opts in through
 * `SqlTableDetailDescriptor.tabs`; nothing renders a tab it didn't list.
 */
export type TableTab =
  | "data"
  | "structure"
  | "indexes"
  | "constraints"
  | "foreign_keys"
  | "ddl"
  | "stats";

export type SortState = { column: string; dir: "asc" | "desc" } | null;

export interface DataField {
  name: string;
  /** The driver's own type name, where the rows response carries one. Used
   *  as the grid's header hint when column metadata hasn't loaded. */
  dataType?: string;
}

/** One page of rows, normalized away from each driver's own row shape. */
export interface DataPage {
  /** Columns, in grid order. */
  fields: DataField[];
  /** Row tuples aligned with `fields` — MySQL's object rows get flattened here. */
  rows: unknown[][];
  /** Total rows in the table, or null when the driver doesn't report one. */
  total: number | null;
}

export interface PageQuery {
  offset: number;
  limit: number;
  sort: SortState;
}

/** Payloads the shell has loaded so far, keyed by tab. */
export type TabData = Partial<Record<TableTab, unknown>>;

/** The handle the shell hands to panels and to the client's own dialogs. */
export interface TableDetailControl {
  tab: TableTab;
  setTab(tab: TableTab): void;
  /**
   * Every payload loaded so far. The client's own header actions and dialogs
   * read the schema from here — the shell owns the fetch, so this is the only
   * place the column list exists.
   */
  all: TabData;
  /**
   * Forget these tabs' payloads and any error against them, so the load
   * effect re-fires. This is the post-mutation refresh path: clearing the
   * cache without clearing the error would leave the guard permanently
   * unsatisfied and strand a stale ErrorState on screen.
   */
  refresh(...tabs: TableTab[]): void;
  /**
   * Re-request the rows. Defaults to the offset the user is on; pass one to
   * jump (a freshly inserted row lands on page 1, not on page 7).
   */
  reloadData(offset?: number): void;
}

export interface TabRenderArgs<TCtx> {
  ctx: TCtx;
  /** This tab's payload. Non-null wherever `render` is called. */
  data: unknown;
  /**
   * Every payload loaded so far. Panels that need a second tab's data read
   * it here — the Postgres Structure tab's FK chips, its Statistics tab's
   * column and index counts.
   */
  all: TabData;
  ctl: TableDetailControl;
}

export interface DataToolbarArgs<TCtx> extends TabRenderArgs<TCtx> {
  page: DataPage;
  /** Rows surviving the toolbar filter — what Export should write out. */
  filtered: unknown[][];
}

export interface DataTabSpec<TCtx> {
  fetch(ctx: TCtx, query: PageQuery, signal: AbortSignal): Promise<DataPage>;
  /** Grid headers, given the page and whatever schema payload has loaded. */
  columns(page: DataPage, all: TabData, ctx: TCtx): GridColumn[];
  /**
   * The tab carrying column metadata. When *it* fails but the rows load, the
   * shell shows a compact banner above the grid rather than replacing it.
   */
  schemaTab: TableTab;
  /** Buttons in the toolbar's right-hand slot, left of Insert row. */
  actions?(args: DataToolbarArgs<TCtx>): React.ReactNode;
  /** Filter + density toolbar. Off for SQL Server, which has neither today. */
  toolbar?: boolean;
  /** Column-header sorting — only MySQL's rows API accepts orderBy. */
  sortable?: boolean;
  /** SQL Server tints its Insert button rose rather than primary. */
  insertClassName?: string;
  /** Merged onto DataGrid's scroll container. */
  gridClassName?: string;
}

/**
 * What the shell gates on. Deliberately only the three row-level actions the
 * shell itself renders: truncate / drop-table / index actions live in the
 * client's own header and dialogs, and a flag the shell never reads would be
 * dead configuration.
 */
export interface TableCapabilities {
  insertRow: boolean;
  editRow: boolean;
  deleteRow: boolean;
}

export interface SqlTableDetailDescriptor<TCtx> {
  tech: TechId;
  tabs: TableTab[];
  /** Tab header text. Defaults to a title-cased tab key. */
  labels?: Partial<Record<TableTab, string>>;
  /** ErrorState heading per tab. Defaults to `Could not load <label>`. */
  errorTitles?: Partial<Record<TableTab, string>>;
  capabilities: TableCapabilities;
  /**
   * Per-*table* gate on the row edit/delete buttons, on top of the per-tech
   * `capabilities` flags: Postgres and MySQL can only address a row by
   * primary key, so a PK-less table renders both buttons disabled with
   * `readOnlyReason` as their title. Defaults to always-mutable.
   */
  rowsMutable?(all: TabData): boolean;
  /** Shown as the edit/delete buttons' title when they're disabled. */
  readOnlyReason?: string;
  paths: { base(ctx: TCtx): string; rows(ctx: TCtx): string };
  /**
   * Where each tab's payload comes from.
   *
   * A *source* is one request, fetched at most once, feeding any number of
   * tabs. That covers all three techs without a per-tech branch: Postgres
   * gives every tab its own source (separate `?view=` round-trips, each lazy
   * until its tab opens), SQL Server points all six at one, and MySQL points
   * three at its table-meta response and two at its constraints endpoint.
   * The Data tab is always its own request — see `data`.
   */
  load: {
    sources: Record<string, (ctx: TCtx, signal: AbortSignal) => Promise<unknown>>;
    /**
     * Which source each tab reads. Defaults to the tab's own name, which is
     * what a tech with one round-trip per tab (Postgres) wants; techs that
     * share a payload across tabs name the shared source here.
     */
    tabSource?: Partial<Record<TableTab, string>>;
    /** Sources fetched on mount, whatever tab is open. */
    eager?: string[];
    /** Opening this tab also loads these sources. */
    prefetch?: Partial<Record<TableTab, string[]>>;
  };
  data: DataTabSpec<TCtx>;
  /** Panel per tab. `data` is the shell's own; anything listed for it is ignored. */
  render: Partial<Record<TableTab, (args: TabRenderArgs<TCtx>) => React.ReactNode>>;
  /**
   * Rendered above the panel whatever the load state — the Postgres Indexes
   * tab's "N indexes · New index" bar, which stays clickable while the
   * indexes request is in flight or has failed.
   */
  toolbar?: Partial<Record<TableTab, (args: TabRenderArgs<TCtx>) => React.ReactNode>>;
  /** Loading placeholder per tab. Defaults to a single h-32 skeleton. */
  skeleton?: Partial<Record<TableTab, React.ReactNode>>;
  /** Extra classes on the TabsContent — SQL Server's full-height Data tab. */
  contentClassName?: Partial<Record<TableTab, string>>;
}
