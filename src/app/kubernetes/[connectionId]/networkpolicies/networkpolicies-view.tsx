"use client";

import type { K8sList } from "@/lib/kubernetes/list";
import type { NetworkPolicyRow } from "@/lib/kubernetes/row-types";
import { ResourceTable, type Column } from "../resource-table";
import { namespaceColumn, nameColumn, ageColumn, textColumn, numberColumn } from "../columns";

const COLUMNS: Column<NetworkPolicyRow>[] = [
  namespaceColumn(),
  nameColumn(),
  textColumn("pod selector", "w-56", (r) => r.podSelector, "text-cyan-600 dark:text-cyan-400"),
  textColumn("policy types", "w-32", (r) => r.policyTypes),
  numberColumn("ingress", (r) => r.ingressRules, "w-20"),
  numberColumn("egress", (r) => r.egressRules, "w-20"),
  ageColumn(),
];

export function NetworkPoliciesView({ list }: { list: K8sList<NetworkPolicyRow> }) {
  return (
    <ResourceTable
      resource="NetworkPolicies"
      shortName="netpol"
      kind="networkpolicy"
      rows={list.rows}
      truncated={list.truncated}
      remaining={list.remaining}
      columns={COLUMNS}
      actions={{ edit: true, delete: true }}
    />
  );
}
