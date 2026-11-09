import type { ServiceAccountRow } from "@/lib/kubernetes/row-types";
import { ServiceAccountsView } from "./serviceaccounts-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function ServiceAccountsPage(props: ListPageProps) {
  const result = await loadList<ServiceAccountRow>(props, "serviceaccounts");
  return result.ok ? (
    <ServiceAccountsView list={result.list} />
  ) : (
    <LoadError resource="serviceaccounts" error={result.error} />
  );
}
