"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { ResourceQuotaRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn } from "../columns";

const COLUMNS: Column<ResourceQuotaRow>[] = [
  namespaceColumn(),
  nameColumn("w-48"),
  textColumn("used / hard", null, (r) => r.usage, "text-foreground"),
  ageColumn(),
];

export function ResourceQuotasView({ list }: { list: K8sList<ResourceQuotaRow> }) {
  return (
    <ResourceTable
      resource="ResourceQuotas"
      shortName="quota"
      kind="resourcequota"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
