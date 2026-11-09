"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { HpaRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn, numberColumn } from "../columns";

const COLUMNS: Column<HpaRow>[] = [
  namespaceColumn(),
  nameColumn("w-48"),
  textColumn("reference", "w-48", (r) => r.target, "text-cyan-600 dark:text-cyan-400"),
  textColumn("targets", null, (r) => r.metrics),
  numberColumn("min", (r) => r.minReplicas),
  numberColumn("max", (r) => r.maxReplicas),
  numberColumn("current", (r) => r.current),
  numberColumn("desired", (r) => r.desired),
  ageColumn(),
];

export function HpasView({ list }: { list: K8sList<HpaRow> }) {
  return (
    <ResourceTable
      resource="HorizontalPodAutoscalers"
      shortName="hpa"
      kind="horizontalpodautoscaler"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
