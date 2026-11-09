"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { RoleRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn, numberColumn } from "../columns";

const COLUMNS: Column<RoleRow>[] = [
  namespaceColumn(),
  nameColumn(),
  numberColumn("rules", (r) => r.rules),
  textColumn("verbs / resources", null, (r) => r.summary),
  ageColumn(),
];

export function RolesView({ list }: { list: K8sList<RoleRow> }) {
  return (
    <ResourceTable
      resource="Roles"
      shortName="role"
      kind="role"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
