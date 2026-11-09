"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { ServiceAccountRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, numberColumn } from "../columns";

const COLUMNS: Column<ServiceAccountRow>[] = [
  namespaceColumn(),
  nameColumn("w-80"),
  numberColumn("secrets", (r) => r.secrets, "w-20"),
  ageColumn(),
];

export function ServiceAccountsView({ list }: { list: K8sList<ServiceAccountRow> }) {
  return (
    <ResourceTable
      resource="ServiceAccounts"
      shortName="sa"
      kind="serviceaccount"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
