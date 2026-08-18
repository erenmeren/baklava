"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type DaemonSetRow } from "@/lib/kubernetes/row-types";

const COLUMNS: Column<DaemonSetRow>[] = [
  {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace}</span>,
    value: (r) => r.namespace,
  },
  {
    label: "name",
    width: "w-64",
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "desired",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.desired}</span>,
    value: (r) => r.desired,
  },
  {
    label: "current",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.current}</span>,
    value: (r) => r.current,
  },
  {
    label: "ready",
    width: "w-16",
    align: "right",
    cell: (r) => <span className={r.ready === r.desired ? "text-emerald-600 dark:text-emerald-400 tabular-nums" : "text-amber-600 dark:text-amber-400 tabular-nums"}>{r.ready}</span>,
    value: (r) => r.ready,
  },
  {
    label: "up-to-date",
    width: "w-20",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.upToDate}</span>,
    value: (r) => r.upToDate,
  },
  {
    label: "available",
    width: "w-20",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.available}</span>,
    value: (r) => r.available,
  },
  {
    label: "image",
    width: null,
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400 truncate" title={r.image}>{r.image}</span>,
    value: (r) => r.image,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  },
];

export function DaemonSetsView({ list }: { list: K8sList<DaemonSetRow> }) {
  return (
    <ResourceTable
      resource="DaemonSets"
      shortName="ds"
      kind="daemonset"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
