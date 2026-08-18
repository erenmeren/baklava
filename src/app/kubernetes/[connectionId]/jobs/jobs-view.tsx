"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type JobRow } from "@/lib/kubernetes/row-types";
import { cn } from "@/lib/utils";

const COLUMNS: Column<JobRow>[] = [
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
    label: "status",
    width: "w-24",
    cell: (r) => <span className={cn(r.status === "Complete" && "text-emerald-600 dark:text-emerald-400", r.status === "Failed" && "text-red-600 dark:text-red-400", r.status === "Running" && "text-cyan-600 dark:text-cyan-400", r.status === "Pending" && "text-muted-foreground")}>{r.status}</span>,
    value: (r) => r.status,
  },
  {
    label: "completions",
    width: "w-24",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.completions}</span>,
    value: (r) => r.completions,
  },
  {
    label: "duration",
    width: "w-20",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{r.duration}</span>,
    value: (r) => r.duration,
  },
  {
    label: "failed",
    width: "w-16",
    align: "right",
    cell: (r) => <span className={r.failed > 0 ? "text-red-600 dark:text-red-400 tabular-nums" : "text-muted-foreground tabular-nums"}>{r.failed}</span>,
    value: (r) => r.failed,
  },
  {
    label: "image",
    width: null,
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400 truncate" title={r.image}>{r.image}</span>,
    value: (r) => r.image,
  },
  {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  },
];

export function JobsView({ list }: { list: K8sList<JobRow> }) {
  return (
    <ResourceTable
      resource="Jobs"
      shortName="job"
      kind="job"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
