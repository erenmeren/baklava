import type { ResourceQuotaRow } from "@/lib/kubernetes/row-types";
import { ResourceQuotasView } from "./resourcequotas-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function ResourceQuotasPage(props: ListPageProps) {
  const result = await loadList<ResourceQuotaRow>(props, "resourcequotas");
  return result.ok ? (
    <ResourceQuotasView list={result.list} />
  ) : (
    <LoadError resource="resourcequotas" error={result.error} />
  );
}
