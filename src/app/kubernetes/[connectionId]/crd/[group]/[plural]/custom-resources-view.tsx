"use client";

import { useMemo } from "react";
import type { K8sList } from "@/lib/kubernetes/list";
import type { CrdIdentity } from "@/lib/kubernetes/crd";
import type { CustomResourceRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../../../resource-table";
import { ageColumn, nameColumn, namespaceColumn, textColumn } from "../../../columns";

export function CustomResourcesView({
  crd,
  list,
}: {
  crd: CrdIdentity;
  list: K8sList<CustomResourceRow>;
}) {
  // Printer columns come from the CRD, so the column set is per page.
  const columns = useMemo<Column<CustomResourceRow>[]>(
    () => [
      ...(crd.namespaced ? [namespaceColumn<CustomResourceRow>()] : []),
      nameColumn<CustomResourceRow>(),
      ...crd.columns.map((c, i) =>
        textColumn<CustomResourceRow>(c.name.toLowerCase(), null, (r) => r.cells[i] ?? "—"),
      ),
      ageColumn<CustomResourceRow>(),
    ],
    [crd],
  );
  return (
    <ResourceTable
      resource={crd.kind}
      shortName={crd.plural}
      // The CRD's own name — resolveObjectKind maps it back to an installed CRD.
      kind={`${crd.plural}.${crd.group}`}
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={columns}
      actions={{ edit: true, delete: true }}
    />
  );
}
