"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { PvRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { nameColumn, ageColumn, textColumn } from "../columns";

const COLUMNS: Column<PvRow>[] = [
  nameColumn(),
  textColumn("capacity", "w-24", (r) => r.capacity, "text-foreground"),
  textColumn("access", "w-24", (r) => r.accessModes),
  textColumn("reclaim", "w-24", (r) => r.reclaimPolicy),
  {
    label: "status",
    width: "w-24",
    cell: (r) => (
      <span className={r.status === "Bound" ? "text-emerald-600 dark:text-emerald-400" : r.status === "Available" ? "text-cyan-600 dark:text-cyan-400" : "text-amber-600 dark:text-amber-400"}>
        {r.status}
      </span>
    ),
    value: (r) => r.status,
  },
  textColumn("claim", null, (r) => r.claim),
  textColumn("class", "w-32", (r) => r.storageClass),
  ageColumn(),
];

export function PvsView({ list }: { list: K8sList<PvRow> }) {
  return (
    <ResourceTable
      resource="PersistentVolumes"
      shortName="pv"
      kind="persistentvolume"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
