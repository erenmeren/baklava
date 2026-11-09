"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { RoleRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { nameColumn, ageColumn, textColumn, numberColumn } from "../columns";

const COLUMNS: Column<RoleRow>[] = [
  nameColumn("w-80"),
  numberColumn("rules", (r) => r.rules),
  textColumn("verbs / resources", null, (r) => r.summary),
  ageColumn(),
];

export function ClusterRolesView({ list }: { list: K8sList<RoleRow> }) {
  return (
    <ResourceTable
      resource="ClusterRoles"
      shortName="cr"
      kind="clusterrole"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
