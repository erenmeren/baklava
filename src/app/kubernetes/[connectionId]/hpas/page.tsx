import type { HpaRow } from "@/lib/kubernetes/row-types";
import { HpasView } from "./hpas-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function HpasPage(props: ListPageProps) {
  const result = await loadList<HpaRow>(props, "hpas");
  return result.ok ? (
    <HpasView list={result.list} />
  ) : (
    <LoadError resource="horizontalpodautoscalers" error={result.error} />
  );
}
