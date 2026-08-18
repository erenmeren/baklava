/**
 * The `:` command vocabulary of the Kubernetes workspace, and the resource
 * catalogue behind it. One list drives the sidebar, the palette suggestions
 * and the command parser, so a new resource can't be reachable from one and
 * missing from another.
 */

export type ResourceGroup = "Workloads" | "Network" | "Config" | "Storage" | "Cluster";

export interface K8sResource {
  /** URL segment under /kubernetes/<id>/ — also the canonical command. */
  path: string;
  label: string;
  group: ResourceGroup;
  /** k9s-style short forms accepted by `:`. */
  aliases: string[];
  /** Digit that jumps here, for the six original screens plus nodes/events. */
  hotkey?: string;
}

export const K8S_RESOURCES: K8sResource[] = [
  { path: "pods", label: "Pods", group: "Workloads", aliases: ["po", "pod"], hotkey: "1" },
  { path: "deployments", label: "Deployments", group: "Workloads", aliases: ["dep", "deploy", "deployment"], hotkey: "2" },
  { path: "statefulsets", label: "StatefulSets", group: "Workloads", aliases: ["sts", "statefulset"] },
  { path: "daemonsets", label: "DaemonSets", group: "Workloads", aliases: ["ds", "daemonset"] },
  { path: "jobs", label: "Jobs", group: "Workloads", aliases: ["job"] },
  { path: "cronjobs", label: "CronJobs", group: "Workloads", aliases: ["cj", "cronjob"] },
  { path: "services", label: "Services", group: "Network", aliases: ["svc", "service"], hotkey: "3" },
  { path: "ingresses", label: "Ingresses", group: "Network", aliases: ["ing", "ingress"] },
  { path: "configmaps", label: "ConfigMaps", group: "Config", aliases: ["cm", "configmap"], hotkey: "4" },
  { path: "secrets", label: "Secrets", group: "Config", aliases: ["sec", "secret"], hotkey: "5" },
  { path: "pvcs", label: "PVCs", group: "Storage", aliases: ["pvc", "persistentvolumeclaims"] },
  { path: "namespaces", label: "Namespaces", group: "Cluster", aliases: [], hotkey: "6" },
  { path: "nodes", label: "Nodes", group: "Cluster", aliases: ["no", "node"], hotkey: "7" },
  { path: "events", label: "Events", group: "Cluster", aliases: ["ev", "event"], hotkey: "8" },
];

export const RESOURCE_GROUPS: ResourceGroup[] = [
  "Workloads",
  "Network",
  "Config",
  "Storage",
  "Cluster",
];

const BY_WORD = new Map<string, string>();
for (const r of K8S_RESOURCES) {
  BY_WORD.set(r.path, r.path);
  for (const a of r.aliases) BY_WORD.set(a, r.path);
}

export const HOTKEYS: Record<string, string> = Object.fromEntries(
  K8S_RESOURCES.filter((r) => r.hotkey).map((r) => [r.hotkey!, r.path]),
);

export type Command =
  | { kind: "navigate"; target: string }
  | { kind: "namespace"; namespace: string };

/**
 * Parse a `:` command. `ns`/`namespace` with an argument switches namespace;
 * without one it means "show me the namespaces", which is what k9s does.
 * Unknown input returns null so the palette can stay open.
 */
export function resolveCommand(input: string): Command | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const [head, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(" ");

  if ((head === "ns" || head === "namespace") && arg) {
    return { kind: "namespace", namespace: arg === "all" ? "*" : arg };
  }
  if (head === "ns" || head === "namespace") {
    return { kind: "navigate", target: "namespaces" };
  }

  const target = BY_WORD.get(head);
  return target ? { kind: "navigate", target } : null;
}
