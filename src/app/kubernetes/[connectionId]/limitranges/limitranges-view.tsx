"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { LimitRangeRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn } from "../columns";

const COLUMNS: Column<LimitRangeRow>[] = [
  namespaceColumn(),
  nameColumn("w-48"),
  textColumn("limits", null, (r) => r.limits, "text-foreground"),
  ageColumn(),
];

export function LimitRangesView({ list }: { list: K8sList<LimitRangeRow> }) {
  return (
    <ResourceTable
      resource="LimitRanges"
      shortName="limits"
      kind="limitrange"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
