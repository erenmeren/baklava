import type { RoleRow } from "@/lib/kubernetes/row-types";
import { RolesView } from "./roles-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function RolesPage(props: ListPageProps) {
  const result = await loadList<RoleRow>(props, "roles");
  return result.ok ? (
    <RolesView list={result.list} />
  ) : (
    <LoadError resource="roles" error={result.error} />
  );
}
