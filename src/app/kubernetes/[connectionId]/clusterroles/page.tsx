import type { RoleRow } from "@/lib/kubernetes/row-types";
import { ClusterRolesView } from "./clusterroles-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function ClusterRolesPage(props: ListPageProps) {
  const result = await loadList<RoleRow>(props, "clusterroles");
  return result.ok ? (
    <ClusterRolesView list={result.list} />
  ) : (
    <LoadError resource="clusterroles" error={result.error} />
  );
}
