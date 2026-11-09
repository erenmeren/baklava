"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { PdbRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn, numberColumn } from "../columns";

const COLUMNS: Column<PdbRow>[] = [
  namespaceColumn(),
  nameColumn(),
  textColumn("min avail", "w-20", (r) => r.minAvailable),
  textColumn("max unavail", "w-24", (r) => r.maxUnavailable),
  numberColumn("healthy", (r) => r.currentHealthy, "w-20"),
  numberColumn("desired", (r) => r.desiredHealthy, "w-20"),
  {
    label: "allowed",
    width: "w-20",
    align: "right",
    cell: (r) => (
      <span className={r.disruptionsAllowed > 0 ? "tabular-nums text-emerald-600 dark:text-emerald-400" : "tabular-nums text-amber-600 dark:text-amber-400"}>
        {r.disruptionsAllowed}
      </span>
    ),
    value: (r) => r.disruptionsAllowed,
  },
  ageColumn(),
];

export function PdbsView({ list }: { list: K8sList<PdbRow> }) {
  return (
    <ResourceTable
      resource="PodDisruptionBudgets"
      shortName="pdb"
      kind="poddisruptionbudget"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
