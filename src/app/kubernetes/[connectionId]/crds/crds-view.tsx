"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { CrdRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { nameColumn, ageColumn, textColumn } from "../columns";

const COLUMNS: Column<CrdRow>[] = [
  nameColumn("w-80"),
  textColumn("kind", "w-40", (r) => r.kind, "text-foreground"),
  textColumn("group", null, (r) => r.group),
  textColumn("scope", "w-24", (r) => r.scope),
  textColumn("versions", "w-24", (r) => r.versions),
  ageColumn(),
];

export function CrdsView({ list }: { list: K8sList<CrdRow> }) {
  return (
    <ResourceTable
      resource="CustomResourceDefinitions"
      shortName="crd"
      kind="customresourcedefinition"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      // Read-only: deleting a CRD deletes every instance of it cluster-wide.
      actions={{}}
    />
  );
}
