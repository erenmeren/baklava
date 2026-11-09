import type { PdbRow } from "@/lib/kubernetes/row-types";
import { PdbsView } from "./pdbs-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function PdbsPage(props: ListPageProps) {
  const result = await loadList<PdbRow>(props, "pdbs");
  return result.ok ? (
    <PdbsView list={result.list} />
  ) : (
    <LoadError resource="poddisruptionbudgets" error={result.error} />
  );
}
