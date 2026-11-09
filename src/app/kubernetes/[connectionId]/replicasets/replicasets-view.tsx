"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { ReplicaSetRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn, numberColumn } from "../columns";

const COLUMNS: Column<ReplicaSetRow>[] = [
  namespaceColumn(),
  nameColumn(),
  textColumn("owner", "w-48", (r) => r.owner),
  numberColumn("desired", (r) => r.desired),
  numberColumn("current", (r) => r.current),
  numberColumn("ready", (r) => r.ready),
  textColumn("images", null, (r) => r.images),
  ageColumn(),
];

export function ReplicaSetsView({ list }: { list: K8sList<ReplicaSetRow> }) {
  return (
    <ResourceTable
      resource="ReplicaSets"
      shortName="rs"
      kind="replicaset"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
