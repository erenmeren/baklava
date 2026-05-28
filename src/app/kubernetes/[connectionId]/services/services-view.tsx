"use client";

import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type ServiceRow } from "@/lib/kubernetes/mock-cluster";
import { cn } from "@/lib/utils";

const TYPE_STYLE: Record<ServiceRow["type"], string> = {
  ClusterIP: "text-muted-foreground",
  Headless: "text-zinc-500",
  NodePort: "text-amber-600 dark:text-amber-400",
  LoadBalancer: "text-cyan-600 dark:text-cyan-400",
  ExternalName: "text-pink-600 dark:text-pink-400",
};

const COLUMNS: Column<ServiceRow>[] = [
  {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace}</span>,
    value: (r) => r.namespace,
  },
  {
    label: "name",
    width: "w-72",
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "type",
    width: "w-32",
    cell: (r) => <span className={cn(TYPE_STYLE[r.type])}>{r.type}</span>,
    value: (r) => r.type,
  },
  {
    label: "cluster-ip",
    width: "w-32",
    cell: (r) => (
      <span className="text-muted-foreground tabular-nums">{r.clusterIP}</span>
    ),
    value: (r) => r.clusterIP,
  },
  {
    label: "external-ip",
    width: "w-72",
    cell: (r) => (
      <span
        className={cn(
          "truncate",
          r.externalIP === "<none>"
            ? "text-muted-foreground/60"
            : "text-cyan-600 dark:text-cyan-400",
        )}
        title={r.externalIP}
      >
        {r.externalIP}
      </span>
    ),
    value: (r) => r.externalIP,
  },
  {
    label: "ports",
    width: "w-56",
    cell: (r) => (
      <span className="text-foreground/80 truncate" title={r.ports}>
        {r.ports}
      </span>
    ),
    value: (r) => r.ports,
  },
  {
    label: "selector",
    width: "w-48",
    cell: (r) => (
      <span className="text-muted-foreground truncate" title={r.selector}>
        {r.selector}
      </span>
    ),
    value: (r) => r.selector,
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

export function ServicesView({ rows }: { rows: ServiceRow[] }) {
  return (
    <ResourceTable
      resource="Services"
      shortName="svc"
      kind="service"
      rows={rows}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
