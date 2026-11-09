import type { Column } from "./resource-table";
import { formatAge } from "@/lib/kubernetes/row-types";

/** The namespace / name / age columns every list repeats. */
export function namespaceColumn<T extends { namespace?: string }>(): Column<T> {
  return {
    label: "namespace",
    width: "w-32",
    cell: (r) => <span className="text-muted-foreground">{r.namespace ?? "—"}</span>,
    value: (r) => r.namespace ?? "",
  };
}

export function nameColumn<T extends { name: string }>(width = "w-64"): Column<T> {
  return {
    label: "name",
    width,
    cell: (r) => <span className="text-foreground truncate" title={r.name}>{r.name}</span>,
    value: (r) => r.name,
  };
}

export function ageColumn<T extends { ageSeconds: number }>(): Column<T> {
  return {
    label: "age",
    width: "w-16",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{formatAge(r.ageSeconds)}</span>,
    value: (r) => r.ageSeconds,
  };
}

/** A plain text column; `null` width takes the remaining space. */
export function textColumn<T>(
  label: string,
  width: string | null,
  get: (r: T) => string,
  tone = "text-muted-foreground",
): Column<T> {
  return {
    label,
    width,
    cell: (r) => <span className={`${tone} truncate`} title={get(r)}>{get(r)}</span>,
    value: get,
  };
}

export function numberColumn<T>(label: string, get: (r: T) => number, width = "w-16"): Column<T> {
  return {
    label,
    width,
    align: "right",
    cell: (r) => <span className="tabular-nums">{get(r)}</span>,
    value: get,
  };
}
