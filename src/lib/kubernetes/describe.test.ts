import { describe, it, expect } from "vitest";
import { describeObject } from "./describe";
import type { EventRow } from "./row-types";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l && !l.startsWith(" "));
  return rest.slice(0, end === -1 ? undefined : end).join("\n");
}

const POD = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: {
    name: "api-0",
    namespace: "payments",
    creationTimestamp: "2026-08-18T11:00:00.000Z",
    labels: { app: "api", tier: "backend" },
    annotations: { "prometheus.io/scrape": "true" },
  },
  spec: {
    nodeName: "worker-1",
    serviceAccountName: "api",
    containers: [
      {
        name: "api",
        image: "ghcr.io/acme/api:1.4.0",
        ports: [{ containerPort: 8080 }],
      },
    ],
  },
  status: {
    phase: "Running",
    podIP: "10.244.1.7",
    conditions: [
      { type: "Ready", status: "True", reason: "" },
      { type: "ContainersReady", status: "False", reason: "ContainersNotReady" },
    ],
    containerStatuses: [
      { name: "api", ready: true, restartCount: 3, state: { running: {} } },
    ],
  },
};

const EVENTS: EventRow[] = [
  {
    namespace: "payments",
    name: "api-0.17f",
    type: "Warning",
    reason: "BackOff",
    object: "Pod/api-0",
    message: "Back-off restarting failed container",
    count: 12,
    ageSeconds: 120,
  },
  {
    namespace: "payments",
    name: "api-0.17e",
    type: "Normal",
    reason: "Pulled",
    object: "Pod/api-0",
    message: "Container image already present on machine",
    count: 1,
    ageSeconds: 3600,
  },
];

describe("describeObject", () => {
  it("opens with the identity block kubectl describe leads with", () => {
    const out = describeObject(POD, [], NOW);
    expect(out).toContain("Name:         api-0");
    expect(out).toContain("Namespace:    payments");
    expect(out).toContain("Kind:         Pod");
  });

  it("lists labels and annotations one per line", () => {
    const out = describeObject(POD, [], NOW);
    expect(out).toContain("app=api");
    expect(out).toContain("tier=backend");
    expect(out).toContain("prometheus.io/scrape=true");
  });

  it("says <none> where kubectl says <none>", () => {
    const bare = { ...POD, metadata: { name: "x", namespace: "d" } };
    const out = describeObject(bare, [], NOW);
    expect(out).toContain("Labels:       <none>");
    expect(out).toContain("Annotations:  <none>");
  });

  it("renders the object's age from its creation timestamp", () => {
    expect(describeObject(POD, [], NOW)).toContain("Age:          1h");
  });

  it("summarises pod placement and network", () => {
    const out = describeObject(POD, [], NOW);
    expect(out).toContain("Node:         worker-1");
    expect(out).toContain("IP:           10.244.1.7");
    expect(out).toContain("Status:       Running");
  });

  it("describes each container with its image, state and restarts", () => {
    const containers = section(describeObject(POD, [], NOW), "Containers:");
    expect(containers).toContain("api:");
    expect(containers).toContain("ghcr.io/acme/api:1.4.0");
    expect(containers).toContain("Running");
    expect(containers).toContain("Restart Count:  3");
  });

  it("reports a waiting container's reason, which is the whole point of describing it", () => {
    const crashing = {
      ...POD,
      status: {
        ...POD.status,
        containerStatuses: [
          {
            name: "api",
            ready: false,
            restartCount: 7,
            state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s" } },
          },
        ],
      },
    };
    const out = describeObject(crashing, [], NOW);
    expect(out).toContain("CrashLoopBackOff");
    expect(out).toContain("back-off 5m0s");
  });

  it("tabulates conditions with their reason", () => {
    const conditions = section(describeObject(POD, [], NOW), "Conditions:");
    expect(conditions).toContain("Ready");
    expect(conditions).toContain("ContainersReady");
    expect(conditions).toContain("ContainersNotReady");
  });

  it("lists events newest first with type, reason, age and message", () => {
    const events = section(describeObject(POD, EVENTS, NOW), "Events:");
    expect(events).toContain("Warning");
    expect(events).toContain("BackOff");
    expect(events).toContain("2m");
    expect(events).toContain("Back-off restarting failed container");
    expect(events.indexOf("BackOff")).toBeLessThan(events.indexOf("Pulled"));
  });

  it("shows a repeated event's count", () => {
    expect(describeObject(POD, EVENTS, NOW)).toContain("(x12)");
  });

  it("says so when there are no events, rather than showing an empty heading", () => {
    expect(describeObject(POD, [], NOW)).toContain("Events:       <none>");
  });

  it("describes a kind it knows nothing special about without falling over", () => {
    const cm = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "settings", namespace: "payments" },
      data: { "app.yaml": "debug: true" },
    };
    const out = describeObject(cm, [], NOW);
    expect(out).toContain("Name:         settings");
    expect(out).toContain("Kind:         ConfigMap");
    expect(out).not.toContain("Containers:");
  });

  it("omits the namespace line for a cluster-scoped object", () => {
    const node = { apiVersion: "v1", kind: "Node", metadata: { name: "worker-1" } };
    expect(describeObject(node, [], NOW)).not.toContain("Namespace:");
  });
});

// `kubectl apply` mirrors the entire manifest — including a Secret's base64
// `data` — into the last-applied-configuration annotation. Printing
// annotations verbatim therefore hands out secret values to anyone who can
// describe the object. The YAML reader strips this annotation for exactly
// this reason; describe must not undo that.
describe("describeObject secret hygiene", () => {
  const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";
  const secret = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "db-credentials",
      namespace: "payments",
      annotations: {
        [LAST_APPLIED]:
          '{"apiVersion":"v1","kind":"Secret","data":{"password":"c3VwZXJzZWNyZXQ="}}',
        "app.kubernetes.io/managed-by": "helm",
      },
    },
    data: { password: "c3VwZXJzZWNyZXQ=" },
  };

  it("never prints the last-applied-configuration annotation", () => {
    const out = describeObject(secret, [], NOW);
    expect(out).not.toContain("c3VwZXJzZWNyZXQ=");
    expect(out).not.toContain(LAST_APPLIED);
  });

  it("strips it on every kind, not just Secrets — the annotation is noise anyway", () => {
    const cm = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "settings", annotations: { [LAST_APPLIED]: "{}" } },
    };
    expect(describeObject(cm, [], NOW)).not.toContain(LAST_APPLIED);
  });

  it("keeps the other annotations", () => {
    expect(describeObject(secret, [], NOW)).toContain("app.kubernetes.io/managed-by=helm");
  });

  it("never prints a Secret's data, whatever else it prints", () => {
    expect(describeObject(secret, [], NOW)).not.toContain("c3VwZXJzZWNyZXQ=");
  });
});
