"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type PvcRow } from "@/lib/kubernetes/row-types";

const COLUMNS: Column<PvcRow>[] = [
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
    label: "status",
    width: "w-24",
    cell: (r) => <span className={r.status === "Bound" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{r.status}</span>,
    value: (r) => r.status,
  },
  {
    label: "capacity",
    width: "w-24",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.capacity}</span>,
    value: (r) => r.capacity,
  },
  {
    label: "access",
    width: "w-24",
    cell: (r) => <span className="text-muted-foreground">{r.accessModes}</span>,
    value: (r) => r.accessModes,
  },
  {
    label: "storage class",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.storageClass}</span>,
    value: (r) => r.storageClass,
  },
  {
    label: "volume",
    width: null,
    cell: (r) => <span className="text-muted-foreground truncate" title={r.volume}>{r.volume}</span>,
    value: (r) => r.volume,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  },
];

export function PvcsView({ list }: { list: K8sList<PvcRow> }) {
  return (
    <ResourceTable
      resource="PVCs"
      shortName="pvc"
      kind="persistentvolumeclaim"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
