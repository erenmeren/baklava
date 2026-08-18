"use client";

import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type CronJobRow } from "@/lib/kubernetes/row-types";

const COLUMNS: Column<CronJobRow>[] = [
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
    label: "schedule",
    width: "w-36",
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400">{r.schedule}</span>,
    value: (r) => r.schedule,
  },
  {
    label: "suspend",
    width: "w-20",
    cell: (r) => <span className={r.suspend ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{r.suspend ? "true" : "false"}</span>,
    value: (r) => r.suspend ? "true" : "false",
  },
  {
    label: "active",
    width: "w-16",
    align: "right",
    cell: (r) => <span className={r.active > 0 ? "text-emerald-600 dark:text-emerald-400 tabular-nums" : "text-muted-foreground tabular-nums"}>{r.active}</span>,
    value: (r) => r.active,
  },
  {
    label: "last schedule",
    width: "w-28",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{r.lastScheduleSeconds === null ? "never" : formatAge(r.lastScheduleSeconds)}</span>,
    value: (r) => r.lastScheduleSeconds ?? Number.MAX_SAFE_INTEGER,
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

export function CronJobsView({ rows }: { rows: CronJobRow[] }) {
  return (
    <ResourceTable
      resource="CronJobs"
      shortName="cj"
      kind="cronjob"
      rows={rows}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
