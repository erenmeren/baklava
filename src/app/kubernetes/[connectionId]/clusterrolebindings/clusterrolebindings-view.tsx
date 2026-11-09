"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { RoleBindingRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { nameColumn, ageColumn, textColumn } from "../columns";

const COLUMNS: Column<RoleBindingRow>[] = [
  nameColumn("w-80"),
  textColumn("role", "w-64", (r) => r.role, "text-cyan-600 dark:text-cyan-400"),
  textColumn("subjects", null, (r) => r.subjects),
  ageColumn(),
];

export function ClusterRoleBindingsView({ list }: { list: K8sList<RoleBindingRow> }) {
  return (
    <ResourceTable
      resource="ClusterRoleBindings"
      shortName="crb"
      kind="clusterrolebinding"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
