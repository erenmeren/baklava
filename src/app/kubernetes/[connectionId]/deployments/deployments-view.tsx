"use client";

import { ResourceTable, type Column, type RowAction } from "../resource-table";
import { formatAge, type DeploymentRow } from "@/lib/kubernetes/row-types";
import { useK8s } from "../k8s-context";
import { RestartDialog, ScaleDialog } from "./deployment-actions";

const COLUMNS: Column<DeploymentRow>[] = [
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
    label: "ready",
    width: "w-16",
    align: "right",
    cell: (r) => {
      const [a, b] = r.ready.split("/");
      const ok = a === b;
      return (
        <span
          className={
            ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400"
          }
        >
          {r.ready}
        </span>
      );
    },
    value: (r) => r.ready,
  },
  {
    label: "up-to-date",
    width: "w-20",
    align: "right",
    cell: (r) => <span>{r.upToDate}</span>,
    value: (r) => r.upToDate,
  },
  {
    label: "available",
    width: "w-20",
    align: "right",
    cell: (r) => (
      <span
        className={
          r.available > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        }
      >
        {r.available}
      </span>
    ),
    value: (r) => r.available,
  },
  {
    label: "image",
    width: null,
    cell: (r) => (
      <span className="text-cyan-600 dark:text-cyan-400 truncate" title={r.image}>
        {r.image}
      </span>
    ),
    value: (r) => r.image,
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

export function DeploymentsView({ rows }: { rows: DeploymentRow[] }) {
  const { connectionId } = useK8s();
  // Capitals so they can't be hit by accident while navigating with j/k.
  const rowActions: RowAction<DeploymentRow>[] = [
    {
      key: "S",
      label: "scale",
      render: ({ row, close, refresh }) => (
        <ScaleDialog
          connectionId={connectionId}
          row={row}
          close={close}
          refresh={refresh}
        />
      ),
    },
    {
      key: "R",
      label: "restart",
      danger: true,
      render: ({ row, close, refresh }) => (
        <RestartDialog
          connectionId={connectionId}
          row={row}
          close={close}
          refresh={refresh}
        />
      ),
    },
  ];
  return (
    <ResourceTable
      resource="Deployments"
      shortName="deploy"
      kind="deployment"
      rows={rows}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
      rowActions={rowActions}
    />
  );
}
