import type { RoleBindingRow } from "@/lib/kubernetes/row-types";
import { ClusterRoleBindingsView } from "./clusterrolebindings-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function ClusterRoleBindingsPage(props: ListPageProps) {
  const result = await loadList<RoleBindingRow>(props, "clusterrolebindings");
  return result.ok ? (
    <ClusterRoleBindingsView list={result.list} />
  ) : (
    <LoadError resource="clusterrolebindings" error={result.error} />
  );
}
