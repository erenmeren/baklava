import type { StorageClassRow } from "@/lib/kubernetes/row-types";
import { StorageClassesView } from "./storageclasses-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function StorageClassesPage(props: ListPageProps) {
  const result = await loadList<StorageClassRow>(props, "storageclasses");
  return result.ok ? (
    <StorageClassesView list={result.list} />
  ) : (
    <LoadError resource="storageclasses" error={result.error} />
  );
}
