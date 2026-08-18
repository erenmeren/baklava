"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import { ResourceTable, type Column } from "../resource-table";
import { formatAge, type SecretRow } from "@/lib/kubernetes/row-types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<SecretRow["type"], string> = {
  Opaque: "Opaque",
  "kubernetes.io/dockerconfigjson": "docker-cfg",
  "kubernetes.io/tls": "TLS",
  "kubernetes.io/service-account-token": "sa-token",
};

const TYPE_STYLE: Record<SecretRow["type"], string> = {
  Opaque: "text-muted-foreground",
  "kubernetes.io/dockerconfigjson": "text-amber-600 dark:text-amber-400",
  "kubernetes.io/tls": "text-pink-600 dark:text-pink-400",
  "kubernetes.io/service-account-token": "text-cyan-600 dark:text-cyan-400",
};

const COLUMNS: Column<SecretRow>[] = [
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
    label: "type",
    width: "w-32",
    cell: (r) => (
      <span className={cn(TYPE_STYLE[r.type])}>{TYPE_LABEL[r.type]}</span>
    ),
    value: (r) => r.type,
  },
  {
    label: "data",
    width: "w-16",
    align: "right",
    cell: (r) => (
      <span className="text-cyan-600 dark:text-cyan-400 tabular-nums">
        {r.dataKeys}
      </span>
    ),
    value: (r) => r.dataKeys,
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

export function SecretsView({ list }: { list: K8sList<SecretRow> }) {
  return (
    <ResourceTable
      resource="Secrets"
      shortName="sec"
      kind="secret"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
