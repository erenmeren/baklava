import type { PvRow } from "@/lib/kubernetes/row-types";
import { PvsView } from "./pvs-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function PvsPage(props: ListPageProps) {
  const result = await loadList<PvRow>(props, "pvs");
  return result.ok ? (
    <PvsView list={result.list} />
  ) : (
    <LoadError resource="persistentvolumes" error={result.error} />
  );
}
