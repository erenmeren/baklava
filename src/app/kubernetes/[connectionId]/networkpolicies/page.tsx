import type { NetworkPolicyRow } from "@/lib/kubernetes/row-types";
import { NetworkPoliciesView } from "./networkpolicies-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function NetworkPoliciesPage(props: ListPageProps) {
  const result = await loadList<NetworkPolicyRow>(props, "networkpolicies");
  return result.ok ? (
    <NetworkPoliciesView list={result.list} />
  ) : (
    <LoadError resource="networkpolicies" error={result.error} />
  );
}
