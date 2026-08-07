"use client";

import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type NamespaceRow } from "@/lib/kubernetes/row-types";
import { StatusPill } from "../status-pill";

const COLUMNS: Column<NamespaceRow>[] = [
  {
    label: "name",
    width: "w-64",
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "status",
    width: "w-32",
    cell: (r) => (
      <StatusPill status={r.status === "Active" ? "Running" : "Terminating"} />
    ),
    value: (r) => r.status,
  },
  {
    label: "pods",
    width: "w-16",
    align: "right",
    cell: (r) => (
      <span className="text-cyan-600 dark:text-cyan-400 tabular-nums">
        {r.pods}
      </span>
    ),
    value: (r) => r.pods,
  },
  {
    label: "labels",
    width: null,
    cell: (r) => (
      <span className="text-muted-foreground truncate" title={r.labels}>
        {r.labels}
      </span>
    ),
    value: (r) => r.labels,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => (
      <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>
    ),
    value: (r) => r.ageSeconds,
  },
];

// Namespaces have no `namespace` field of their own — give the row an empty
// one so the shared table's namespace filter doesn't hide everything.
type NsRow = NamespaceRow & { namespace?: string };

export function NamespacesView({ rows }: { rows: NamespaceRow[] }) {
  const withNs: NsRow[] = rows.map((r) => ({ ...r, namespace: undefined }));
  return (
    <ResourceTable
      resource="Namespaces"
      shortName="ns"
      kind="namespace"
      rows={withNs}
      columns={COLUMNS as Column<NsRow>[]}
      actions={{ edit: true, delete: true }}
    />
  );
}
