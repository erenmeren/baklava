import type { LimitRangeRow } from "@/lib/kubernetes/row-types";
import { LimitRangesView } from "./limitranges-view";
import { LoadError } from "../load-error";
import { loadList, type ListPageProps } from "../list-page";

export const dynamic = "force-dynamic";

export default async function LimitRangesPage(props: ListPageProps) {
  const result = await loadList<LimitRangeRow>(props, "limitranges");
  return result.ok ? (
    <LimitRangesView list={result.list} />
  ) : (
    <LoadError resource="limitranges" error={result.error} />
  );
}
