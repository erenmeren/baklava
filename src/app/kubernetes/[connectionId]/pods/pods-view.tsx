"use client";

import { ResourceTable, type Column } from "../resource-table";
import { StatusPill } from "../status-pill";
import { formatAge, type PodRow } from "@/lib/kubernetes/mock-cluster";

const COLUMNS: Column<PodRow>[] = [
  {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace}</span>,
    value: (r) => r.namespace,
  },
  {
    label: "name",
    width: null,
    cell: (r) => <span className="text-foreground">{r.name}</span>,
    value: (r) => r.name,
  },
  {
    label: "ready",
    width: "w-16",
    align: "right",
    cell: (r) => {
      const [a, b] = r.ready.split("/");
      const healthy = a === b;
      return (
        <span className={healthy ? "text-foreground" : "text-amber-600 dark:text-amber-400"}>
          {r.ready}
        </span>
      );
    },
    value: (r) => r.ready,
  },
  {
    label: "status",
    width: "w-40",
    cell: (r) => <StatusPill status={r.status} />,
    value: (r) => r.status,
  },
  {
    label: "restarts",
    width: "w-20",
    align: "right",
    cell: (r) => (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span
          className={
            r.restarts === 0
              ? "text-muted-foreground"
              : r.restarts > 5
                ? "text-red-600 dark:text-red-400"
                : "text-amber-600 dark:text-amber-400"
          }
        >
          {r.restarts}
        </span>
        {r.lastRestart ? (
          <span className="text-[10px] text-muted-foreground/70">
            ({r.lastRestart})
          </span>
        ) : null}
      </span>
    ),
    value: (r) => r.restarts,
  },
  {
    label: "ip",
    width: "w-32",
    cell: (r) => (
      <span className="text-muted-foreground tabular-nums">{r.ip || "—"}</span>
    ),
    value: (r) => r.ip,
  },
  {
    label: "node",
    width: "w-72",
    cell: (r) => (
      <span className="text-muted-foreground truncate" title={r.node}>
        {r.node}
      </span>
    ),
    value: (r) => r.node,
  },
  {
    label: "cpu",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400">{r.cpu}</span>,
    value: (r) => r.cpu,
  },
  {
    label: "mem",
    width: "w-20",
    align: "right",
    cell: (r) => <span className="text-cyan-600 dark:text-cyan-400">{r.mem}</span>,
    value: (r) => r.mem,
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

function describePod(p: PodRow): string {
  return [
    `Name:             ${p.name}`,
    `Namespace:        ${p.namespace}`,
    `Priority:         0`,
    `Node:             ${p.node}`,
    `Start Time:       ${new Date(Date.now() - p.ageSeconds * 1000).toISOString()}`,
    `Labels:           app=${p.name.split("-")[0]}`,
    `Status:           ${p.status}`,
    `IP:               ${p.ip || "<none>"}`,
    `QoS Class:        ${p.qos}`,
    ``,
    `Containers:`,
    `  app:`,
    `    Image:        ghcr.io/acme/${p.name.split("-")[0]}:latest`,
    `    State:        ${p.status === "Running" ? "Running" : p.status}`,
    `    Ready:        ${p.ready.startsWith("1/") || p.ready.startsWith("2/") ? "True" : "False"}`,
    `    Restart Count: ${p.restarts}`,
    `    Requests:`,
    `      cpu:        ${p.cpu}`,
    `      memory:     ${p.mem}`,
    ``,
    `Conditions:`,
    `  Type              Status`,
    `  Initialized       True`,
    `  Ready             ${p.ready.startsWith("0/") ? "False" : "True"}`,
    `  ContainersReady   ${p.ready.startsWith("0/") ? "False" : "True"}`,
    `  PodScheduled      True`,
  ].join("\n");
}

export function PodsView({ rows }: { rows: PodRow[] }) {
  return (
    <ResourceTable
      resource="Pods"
      shortName="po"
      kind="pod"
      rows={rows}
      columns={COLUMNS}
      actions={{ logs: true, shell: true, edit: true, delete: true }}
      describeYaml={describePod}
    />
  );
}
