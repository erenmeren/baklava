"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { StorageClassRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { ageColumn, textColumn } from "../columns";

const COLUMNS: Column<StorageClassRow>[] = [
  {
    label: "name",
    width: "w-56",
    cell: (r) => (
      <span className="text-foreground">
        {r.name}
        {r.isDefault && <span className="ml-2 text-[10px] text-cyan-600 dark:text-cyan-400">(default)</span>}
      </span>
    ),
    value: (r) => r.name,
  },
  textColumn("provisioner", null, (r) => r.provisioner, "text-foreground"),
  textColumn("reclaim", "w-24", (r) => r.reclaimPolicy),
  textColumn("binding mode", "w-40", (r) => r.bindingMode),
  textColumn("expansion", "w-20", (r) => (r.allowExpansion ? "yes" : "no")),
  ageColumn(),
];

export function StorageClassesView({ list }: { list: K8sList<StorageClassRow> }) {
  return (
    <ResourceTable
      resource="StorageClasses"
      shortName="sc"
      kind="storageclass"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
