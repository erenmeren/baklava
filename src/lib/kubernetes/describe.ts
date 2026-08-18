/**
 * `kubectl describe`-shaped rendering of a live object plus its events.
 *
 * The table's old "describe" was a dump of the columns already on screen,
 * which told you nothing you couldn't see. What you actually open describe
 * for is the part that isn't in the list: the container state and its reason,
 * the conditions, and the events. That's what this renders.
 *
 * Pure — the driver supplies the object and the (already mapped) events.
 */
import { secondsSince } from "./quantity";
import { formatAge, type EventRow } from "./row-types";

interface DescribableObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string | Date;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: {
    nodeName?: string;
    serviceAccountName?: string;
    containers?: Array<{
      name?: string;
      image?: string;
      ports?: Array<{ containerPort?: number; protocol?: string }>;
    }>;
    [key: string]: unknown;
  };
  status?: {
    phase?: string;
    podIP?: string;
    conditions?: Array<{
      type?: string;
      status?: string;
      reason?: string;
      message?: string;
    }>;
    containerStatuses?: Array<{
      name?: string;
      ready?: boolean;
      restartCount?: number;
      state?: Record<string, { reason?: string; message?: string; exitCode?: number }>;
    }>;
    [key: string]: unknown;
  };
}

const LABEL_WIDTH = 14;
const NONE = "<none>";

/**
 * `kubectl apply` mirrors the whole manifest into this annotation — including
 * a Secret's base64 `data`. Printing it would hand out the very values the
 * redacted YAML view strips, so it never reaches the output. It is also pure
 * noise on every other kind.
 */
const HIDDEN_ANNOTATIONS = new Set(["kubectl.kubernetes.io/last-applied-configuration"]);

function field(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/** Key=value pairs, first on the field's own line and the rest aligned under it. */
function pairs(
  map: Record<string, string> | undefined,
  label: string,
  hidden: Set<string> = new Set(),
): string[] {
  const entries = Object.entries(map ?? {}).filter(([k]) => !hidden.has(k));
  if (entries.length === 0) return [field(label, NONE)];
  const [first, ...rest] = entries.map(([k, v]) => `${k}=${v}`);
  return [field(label, first), ...rest.map((line) => `${" ".repeat(LABEL_WIDTH)}${line}`)];
}

/** "Running" / "Waiting: CrashLoopBackOff" — the state key carries the meaning. */
function containerState(
  state: Record<string, { reason?: string; message?: string; exitCode?: number }> | undefined,
): { label: string; detail: string[] } {
  const [key, body] = Object.entries(state ?? {})[0] ?? [];
  if (!key) return { label: "Unknown", detail: [] };
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  const detail: string[] = [];
  if (body?.reason) detail.push(`Reason:         ${body.reason}`);
  if (body?.exitCode !== undefined) detail.push(`Exit Code:      ${body.exitCode}`);
  if (body?.message) detail.push(`Message:        ${body.message}`);
  return { label, detail };
}

function podSections(obj: DescribableObject): string[] {
  const out: string[] = [];
  if (obj.spec?.nodeName) out.push(field("Node", obj.spec.nodeName));
  if (obj.status?.phase) out.push(field("Status", obj.status.phase));
  if (obj.status?.podIP) out.push(field("IP", obj.status.podIP));
  if (obj.spec?.serviceAccountName) {
    out.push(field("Service Account", obj.spec.serviceAccountName));
  }

  const containers = obj.spec?.containers ?? [];
  if (containers.length === 0) return out;

  const statuses = new Map(
    (obj.status?.containerStatuses ?? []).map((c) => [c.name ?? "", c]),
  );
  out.push("", "Containers:");
  for (const c of containers) {
    const st = statuses.get(c.name ?? "");
    const { label, detail } = containerState(st?.state);
    out.push(`  ${c.name ?? NONE}:`);
    out.push(`    Image:          ${c.image ?? NONE}`);
    const ports = (c.ports ?? [])
      .map((p) => `${p.containerPort}/${p.protocol ?? "TCP"}`)
      .join(", ");
    if (ports) out.push(`    Ports:          ${ports}`);
    if (st) {
      out.push(`    State:          ${label}`);
      for (const line of detail) out.push(`      ${line}`);
      out.push(`    Ready:          ${st.ready ? "True" : "False"}`);
      out.push(`    Restart Count:  ${st.restartCount ?? 0}`);
    }
  }
  return out;
}

function conditionSection(obj: DescribableObject): string[] {
  const conditions = obj.status?.conditions ?? [];
  if (conditions.length === 0) return [];
  const width = Math.max(...conditions.map((c) => (c.type ?? "").length), 4) + 2;
  return [
    "",
    "Conditions:",
    `  ${"Type".padEnd(width)}${"Status".padEnd(10)}Reason`,
    ...conditions.map(
      (c) =>
        `  ${(c.type ?? NONE).padEnd(width)}${(c.status ?? NONE).padEnd(10)}${c.reason || ""}`.trimEnd(),
    ),
  ];
}

function eventSection(events: EventRow[]): string[] {
  if (events.length === 0) return [field("Events", NONE)];
  const sorted = [...events].sort((a, z) => a.ageSeconds - z.ageSeconds);
  return [
    "",
    "Events:",
    `  ${"Type".padEnd(10)}${"Reason".padEnd(22)}${"Age".padEnd(8)}Message`,
    ...sorted.map((e) => {
      const age = e.count > 1 ? `${formatAge(e.ageSeconds)} (x${e.count})` : formatAge(e.ageSeconds);
      return `  ${e.type.padEnd(10)}${e.reason.padEnd(22)}${age.padEnd(8)} ${e.message}`;
    }),
  ];
}

export function describeObject(
  obj: DescribableObject,
  events: EventRow[],
  now: Date = new Date(),
): string {
  const meta = obj.metadata ?? {};
  const lines: string[] = [field("Name", meta.name ?? NONE)];
  if (meta.namespace) lines.push(field("Namespace", meta.namespace));
  lines.push(field("Kind", obj.kind ?? NONE));
  if (obj.apiVersion) lines.push(field("API Version", obj.apiVersion));
  if (meta.creationTimestamp) {
    lines.push(field("Age", formatAge(secondsSince(meta.creationTimestamp, now))));
  }
  lines.push(...pairs(meta.labels, "Labels"));
  lines.push(...pairs(meta.annotations, "Annotations", HIDDEN_ANNOTATIONS));

  if (obj.kind === "Pod") lines.push(...podSections(obj));
  lines.push(...conditionSection(obj));
  lines.push(...eventSection(events));

  return lines.join("\n");
}
