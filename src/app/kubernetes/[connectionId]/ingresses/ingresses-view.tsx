"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type IngressRow } from "@/lib/kubernetes/row-types";

const COLUMNS: Column<IngressRow>[] = [
  {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace}</span>,
    value: (r) => r.namespace,
  },
  {
    label: "name",
    width: "w-64",
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "class",
    width: "w-28",
    cell: (r) => <span className="text-muted-foreground">{r.className}</span>,
    value: (r) => r.className,
  },
  {
    label: "hosts",
    width: "w-56",
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400 truncate" title={r.hosts}>{r.hosts}</span>,
    value: (r) => r.hosts,
  },
  {
    label: "address",
    width: "w-40",
    cell: (r) => <span className="text-muted-foreground truncate" title={r.address}>{r.address}</span>,
    value: (r) => r.address,
  },
  {
    label: "paths",
    width: null,
    cell: (r) => <span className="text-muted-foreground truncate" title={r.paths}>{r.paths}</span>,
    value: (r) => r.paths,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  },
];

export function IngressesView({ list }: { list: K8sList<IngressRow> }) {
  return (
    <ResourceTable
      resource="Ingresses"
      shortName="ing"
      kind="ingress"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
