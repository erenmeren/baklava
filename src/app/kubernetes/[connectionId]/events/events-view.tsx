"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type EventRow } from "@/lib/kubernetes/row-types";
import { cn } from "@/lib/utils";

const COLUMNS: Column<EventRow>[] = [
  {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace}</span>,
    value: (r) => r.namespace,
  },
  {
    label: "last seen",
    width: "w-20",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  },
  {
    label: "type",
    width: "w-20",
    cell: (r) => (
      <span
        className={cn(
          r.type === "Warning"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {r.type}
      </span>
    ),
    value: (r) => r.type,
  },
  {
    label: "reason",
    width: "w-40",
    cell: (r) => <span className="text-foreground">{r.reason}</span>,
    value: (r) => r.reason,
  },
  {
    label: "object",
    width: "w-56",
    cell: (r) => (
      <span className="text-cyan-600 dark:text-cyan-400 truncate" title={r.object}>
        {r.object}
      </span>
    ),
    value: (r) => r.object,
  },
  {
    label: "count",
    width: "w-14",
    align: "right",
    cell: (r) => (
      <span className={cn("tabular-nums", r.count > 1 && "text-amber-600 dark:text-amber-400")}>
        {r.count}
      </span>
    ),
    value: (r) => r.count,
  },
  {
    label: "message",
    width: null,
    cell: (r) => (
      <span className="text-muted-foreground truncate" title={r.message}>
        {r.message}
      </span>
    ),
    value: (r) => r.message,
  },
];

export function EventsView({ list }: { list: K8sList<EventRow> }) {
  return (
    <ResourceTable
      resource="Events"
      shortName="ev"
      kind="event"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{}}
    />
  );
}
