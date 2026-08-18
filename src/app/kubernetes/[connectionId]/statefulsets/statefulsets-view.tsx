"use client";

import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type StatefulSetRow } from "@/lib/kubernetes/row-types";

const COLUMNS: Column<StatefulSetRow>[] = [
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
    label: "ready",
    width: "w-16",
    align: "right",
    cell: (r) => <span className={r.ready.split("/")[0] === r.ready.split("/")[1] ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{r.ready}</span>,
    value: (r) => r.ready,
  },
  {
    label: "service",
    width: "w-48",
    cell: (r) => <span className="text-muted-foreground">{r.service}</span>,
    value: (r) => r.service,
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

export function StatefulSetsView({ rows }: { rows: StatefulSetRow[] }) {
  return (
    <ResourceTable
      resource="StatefulSets"
      shortName="sts"
      kind="statefulset"
      rows={rows}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
