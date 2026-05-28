"use client";

import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type ConfigMapRow } from "@/lib/kubernetes/mock-cluster";

const COLUMNS: Column<ConfigMapRow>[] = [
  {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace}</span>,
    value: (r) => r.namespace,
  },
  {
    label: "name",
    width: null,
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "data",
    width: "w-16",
    align: "right",
    cell: (r) => (
      <span className="text-cyan-600 dark:text-cyan-400 tabular-nums">
        {r.dataKeys}
      </span>
    ),
    value: (r) => r.dataKeys,
  },
  {
    label: "labels",
    width: "w-72",
    cell: (r) => (
      <span className="text-muted-foreground truncate" title={r.labels}>
        {r.labels}
      </span>
    ),
    value: (r) => r.labels,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => (
      <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>
    ),
    value: (r) => r.ageSeconds,
  },
];

export function ConfigMapsView({ rows }: { rows: ConfigMapRow[] }) {
  return (
    <ResourceTable
      resource="ConfigMaps"
      shortName="cm"
      kind="configmap"
      rows={rows}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
