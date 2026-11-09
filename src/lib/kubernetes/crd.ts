/**
 * Custom resources: identity validation, version choice, and the mapping of
 * CRDs and their instances to table rows. Pure — the driver reads the CRD from
 * the cluster and hands it here.
 *
 * Identity: a custom kind is named by its CRD's own name, `<plural>.<group>`
 * (e.g. `widgets.demo.baklava.dev`). The version is never taken from the
 * caller — it comes from the live CRD — so a request can't steer the API path
 * beyond "an installed CRD's served version".
 */
import { evalJsonPath } from "./jsonpath";
import { secondsSince } from "./quantity";
import { formatAge, type CrdRow, type CustomResourceRow } from "./row-types";

const DASH = "—";

/** RFC 1123 label: what Kubernetes requires of a CRD plural and a version. */
const LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
/** RFC 1123 subdomain with at least one dot: what a CRD group must be. */
const GROUP = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$/;

export function isCrdPlural(s: string): boolean {
  return s.length <= 63 && LABEL.test(s);
}

export function isCrdGroup(s: string): boolean {
  return s.length <= 253 && GROUP.test(s) && s.split(".").every((l) => l.length <= 63);
}

export function isCrdVersion(s: string): boolean {
  return s.length <= 63 && LABEL.test(s);
}

/** `<plural>.<group>` when both halves are valid, else null. */
export function crdName(group: string, plural: string): string | null {
  return isCrdGroup(group) && isCrdPlural(plural) ? `${plural}.${group}` : null;
}

/** Split a CRD name back into plural + group, validating both. */
export function parseCrdName(name: string): { plural: string; group: string } | null {
  const dot = name.indexOf(".");
  if (dot <= 0) return null;
  const plural = name.slice(0, dot);
  const group = name.slice(dot + 1);
  return crdName(group, plural) ? { plural, group } : null;
}

export interface PrinterColumn {
  name: string;
  type?: string;
  jsonPath: string;
  priority?: number;
}

export interface CrdObject {
  metadata?: { name?: string; creationTimestamp?: string | Date };
  spec?: {
    group?: string;
    scope?: string;
    names?: { kind?: string; plural?: string };
    versions?: Array<{
      name?: string;
      served?: boolean;
      storage?: boolean;
      additionalPrinterColumns?: PrinterColumn[];
    }>;
  };
}

/** What the sidebar needs to link one installed CRD. */
export interface CrdLink {
  group: string;
  plural: string;
  kind: string;
  namespaced: boolean;
}

/** What the driver needs to read/list a CRD's instances. */
export interface CrdIdentity {
  group: string;
  plural: string;
  version: string;
  kind: string;
  namespaced: boolean;
  /** Default-priority printer columns, minus Age (always shown). */
  columns: Array<{ name: string; type: string; jsonPath: string }>;
}

/**
 * The version to talk to: the storage version when it's served, otherwise the
 * first served one. Null when nothing is served (a CRD mid-migration).
 */
export function crdIdentity(crd: CrdObject): CrdIdentity | null {
  const spec = crd.spec;
  const group = spec?.group ?? "";
  const plural = spec?.names?.plural ?? "";
  const kind = spec?.names?.kind ?? "";
  if (!isCrdGroup(group) || !isCrdPlural(plural) || !/^[A-Za-z][A-Za-z0-9]*$/.test(kind)) {
    return null;
  }
  const served = (spec?.versions ?? []).filter((v) => v.served && v.name && isCrdVersion(v.name));
  const version = served.find((v) => v.storage) ?? served[0];
  if (!version) return null;
  const columns = (version.additionalPrinterColumns ?? [])
    .filter((c) => !c.priority && c.name && c.jsonPath)
    .filter((c) => !(c.jsonPath === ".metadata.creationTimestamp" || c.name.toLowerCase() === "age"))
    .map((c) => ({ name: c.name, type: c.type ?? "string", jsonPath: c.jsonPath }));
  return {
    group,
    plural,
    version: version.name!,
    kind,
    namespaced: spec?.scope !== "Cluster",
    columns,
  };
}

export function mapCrd(crd: CrdObject, now: Date = new Date()): CrdRow {
  const versions = (crd.spec?.versions ?? [])
    .filter((v) => v.served)
    .map((v) => (v.storage ? `${v.name}*` : v.name));
  return {
    name: crd.metadata?.name ?? DASH,
    group: crd.spec?.group ?? DASH,
    kind: crd.spec?.names?.kind ?? DASH,
    plural: crd.spec?.names?.plural ?? DASH,
    scope: crd.spec?.scope ?? DASH,
    versions: versions.join(",") || DASH,
    ageSeconds: secondsSince(crd.metadata?.creationTimestamp, now),
  };
}

function cell(value: unknown, type: string, now: Date): string {
  if (value === undefined || value === null || value === "") return DASH;
  if (type === "date" && (typeof value === "string" || value instanceof Date)) {
    return formatAge(secondsSince(value, now));
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function mapCustomResource(
  obj: { metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date } },
  columns: CrdIdentity["columns"],
  now: Date = new Date(),
): CustomResourceRow {
  const ns = obj.metadata?.namespace;
  return {
    ...(ns ? { namespace: ns } : {}),
    name: obj.metadata?.name ?? DASH,
    cells: columns.map((c) => cell(evalJsonPath(obj, c.jsonPath), c.type, now)),
    ageSeconds: secondsSince(obj.metadata?.creationTimestamp, now),
  };
}
