import "server-only";
import type { KubernetesObject, KubernetesListObject } from "@kubernetes/client-node";
import type { KubernetesConfig } from "../types";
import { bundleFor, readCrd } from "@/lib/connections/kubernetes";
import {
  crdIdentity,
  crdName,
  mapCustomResource,
  type CrdIdentity,
  type CrdLink,
  type CrdObject,
} from "@/lib/kubernetes/crd";
import { LIST_LIMIT, toList, type K8sList } from "@/lib/kubernetes/list";
import { ALL_NAMESPACES } from "@/lib/kubernetes/namespace";
import type { CustomResourceRow } from "@/lib/kubernetes/row-types";

/** Installed, servable CRDs, sorted by kind — the sidebar's "Custom resources" group. */
export async function listCrdLinks(connectionId: string, cfg: KubernetesConfig): Promise<CrdLink[]> {
  const b = await bundleFor(connectionId, cfg);
  const list = (await b.objects.list(
    "apiextensions.k8s.io/v1",
    "CustomResourceDefinition",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    LIST_LIMIT,
  )) as KubernetesListObject<KubernetesObject>;
  return list.items
    .map((o) => crdIdentity(o as CrdObject))
    .filter((id): id is CrdIdentity => id !== null)
    .map(({ group, plural, kind, namespaced }) => ({ group, plural, kind, namespaced }))
    .sort((a, z) => a.kind.localeCompare(z.kind));
}

export class CrdNotFoundError extends Error {}

/**
 * One CRD's instances, bounded like every list. `group`/`plural` come from the
 * URL: they are shape-checked, then must name an installed CRD — the API path
 * is built from that CRD, never from the raw segments.
 */
export async function listCustomResources(
  connectionId: string,
  cfg: KubernetesConfig,
  group: string,
  plural: string,
  namespace: string,
): Promise<{ crd: CrdIdentity; list: K8sList<CustomResourceRow> }> {
  const name = crdName(group, plural);
  if (!name) throw new CrdNotFoundError(`Invalid custom resource: ${plural}.${group}`);
  const b = await bundleFor(connectionId, cfg);
  const raw = await readCrd(b, name).catch(() => null);
  const crd = raw && crdIdentity(raw);
  if (!crd) throw new CrdNotFoundError(`No served CRD named ${name}`);
  const scoped = crd.namespaced && namespace && namespace !== ALL_NAMESPACES ? namespace : undefined;
  const list = (await b.objects.list(
    `${crd.group}/${crd.version}`,
    crd.kind,
    scoped,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    LIST_LIMIT,
  )) as KubernetesListObject<KubernetesObject>;
  const now = new Date();
  return { crd, list: toList(list, (o) => mapCustomResource(o, crd.columns, now)) };
}
