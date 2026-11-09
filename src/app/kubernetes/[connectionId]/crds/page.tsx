import type { CrdRow } from "@/lib/kubernetes/row-types";
import { CrdsView } from "./crds-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function CrdsPage(props: ListPageProps) {
  const result = await loadList<CrdRow>(props, "crds");
  return result.ok ? (
    <CrdsView list={result.list} />
  ) : (
    <LoadError resource="customresourcedefinitions" error={result.error} />
  );
}
