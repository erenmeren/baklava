import type { ReplicaSetRow } from "@/lib/kubernetes/row-types";
import { ReplicaSetsView } from "./replicasets-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function ReplicaSetsPage(props: ListPageProps) {
  const result = await loadList<ReplicaSetRow>(props, "replicasets");
  return result.ok ? (
    <ReplicaSetsView list={result.list} />
  ) : (
    <LoadError resource="replicasets" error={result.error} />
  );
}
