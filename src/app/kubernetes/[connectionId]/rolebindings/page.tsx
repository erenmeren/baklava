import type { RoleBindingRow } from "@/lib/kubernetes/row-types";
import { RoleBindingsView } from "./rolebindings-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function RoleBindingsPage(props: ListPageProps) {
  const result = await loadList<RoleBindingRow>(props, "rolebindings");
  return result.ok ? (
    <RoleBindingsView list={result.list} />
  ) : (
    <LoadError resource="rolebindings" error={result.error} />
  );
}
