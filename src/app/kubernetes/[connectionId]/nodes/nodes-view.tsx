"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type NodeRow } from "@/lib/kubernetes/row-types";
import { cn } from "@/lib/utils";

const COLUMNS: Column<NodeRow>[] = [
  {
    label: "name",
    width: "w-64",
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "status",
    width: "w-44",
    cell: (r) => (
      <span
        className={cn(
          r.status.startsWith("Ready")
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
          !r.schedulable && "opacity-80",
        )}
      >
        {r.status}
      </span>
    ),
    value: (r) => r.status,
  },
  {
    label: "roles",
    width: "w-40",
    cell: (r) => <span className="text-muted-foreground">{r.roles}</span>,
    value: (r) => r.roles,
  },
  {
    label: "version",
    width: "w-28",
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400">{r.version}</span>,
    value: (r) => r.version,
  },
  {
    label: "internal-ip",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.internalIP}</span>,
    value: (r) => r.internalIP,
  },
  {
    label: "cpu",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.cpu}</span>,
    value: (r) => r.cpu,
  },
  {
    label: "memory",
    width: "w-24",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.memory}</span>,
    value: (r) => r.memory,
  },
  {
    label: "pods",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground tabular-nums">{r.podCapacity}</span>,
    value: (r) => r.podCapacity,
  },
  {
    label: "os",
    width: "w-28",
    cell: (r) => <span className="text-muted-foreground">{r.os}</span>,
    value: (r) => r.os,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  },
];

// Nodes are cluster-scoped; an undefined `namespace` keeps the shared table's
// namespace filter from hiding every row.
type Row = NodeRow & { namespace?: string };

export function NodesView({ list }: { list: K8sList<NodeRow> }) {
  return (
    <ResourceTable
      resource="Nodes"
      shortName="no"
      kind="node"
      rows={list.rows as Row[]}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS as Column<Row>[]}
      actions={{ edit: true }}
    />
  );
}
