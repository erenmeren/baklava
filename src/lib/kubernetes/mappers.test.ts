import { describe, it, expect } from "vitest";
import { mapEvent, mapNode } from "./mappers";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const AN_HOUR_AGO = "2026-08-18T11:00:00.000Z";

describe("mapNode", () => {
  const node = {
    metadata: {
      name: "worker-1",
      creationTimestamp: AN_HOUR_AGO,
      labels: {
        "node-role.kubernetes.io/worker": "",
        "kubernetes.io/hostname": "worker-1",
      },
    },
    spec: {},
    status: {
      conditions: [
        { type: "MemoryPressure", status: "False" },
        { type: "Ready", status: "True" },
      ],
      nodeInfo: { kubeletVersion: "v1.31.0", operatingSystem: "linux", architecture: "amd64" },
      addresses: [
        { type: "Hostname", address: "worker-1" },
        { type: "InternalIP", address: "10.0.0.5" },
      ],
      capacity: { cpu: "8", memory: "16308208Ki", pods: "110" },
    },
  };

  it("reads the name, version and internal IP", () => {
    const row = mapNode(node, NOW);
    expect(row.name).toBe("worker-1");
    expect(row.version).toBe("v1.31.0");
    expect(row.internalIP).toBe("10.0.0.5");
  });

  it("is Ready when the Ready condition is True", () => {
    expect(mapNode(node, NOW).status).toBe("Ready");
  });

  it("is NotReady when the Ready condition is False", () => {
    const notReady = {
      ...node,
      status: { ...node.status, conditions: [{ type: "Ready", status: "False" }] },
    };
    expect(mapNode(notReady, NOW).status).toBe("NotReady");
  });

  it("is Unknown when there is no Ready condition at all", () => {
    expect(mapNode({ ...node, status: { ...node.status, conditions: [] } }, NOW).status).toBe(
      "Unknown",
    );
  });

  it("reports a cordoned node as SchedulingDisabled even while Ready", () => {
    const cordoned = { ...node, spec: { unschedulable: true } };
    const row = mapNode(cordoned, NOW);
    expect(row.status).toBe("Ready,SchedulingDisabled");
    expect(row.schedulable).toBe(false);
  });

  it("derives roles from the node-role labels", () => {
    expect(mapNode(node, NOW).roles).toBe("worker");
    const cp = {
      ...node,
      metadata: {
        ...node.metadata,
        labels: {
          "node-role.kubernetes.io/control-plane": "",
          "node-role.kubernetes.io/master": "",
        },
      },
    };
    expect(mapNode(cp, NOW).roles).toBe("control-plane,master");
  });

  it("falls back to <none> when the node carries no role label", () => {
    expect(mapNode({ ...node, metadata: { ...node.metadata, labels: {} } }, NOW).roles).toBe(
      "<none>",
    );
  });

  it("renders capacity in human units", () => {
    const row = mapNode(node, NOW);
    expect(row.cpu).toBe("8");
    expect(row.memory).toBe("15.6 GiB");
    expect(row.podCapacity).toBe(110);
  });

  it("ages from the creation timestamp", () => {
    expect(mapNode(node, NOW).ageSeconds).toBe(3600);
  });

  it("survives a node with almost nothing on it", () => {
    const row = mapNode({ metadata: { name: "ghost" } }, NOW);
    expect(row.name).toBe("ghost");
    expect(row.status).toBe("Unknown");
    expect(row.internalIP).toBe("—");
    expect(row.ageSeconds).toBe(0);
  });
});

describe("mapEvent", () => {
  const event = {
    metadata: { namespace: "payments", name: "api-0.17f", creationTimestamp: AN_HOUR_AGO },
    type: "Warning",
    reason: "BackOff",
    message: "Back-off restarting failed container",
    count: 12,
    involvedObject: { kind: "Pod", name: "api-0" },
    lastTimestamp: "2026-08-18T11:58:00.000Z",
  };

  it("carries the type, reason and message through", () => {
    const row = mapEvent(event, NOW);
    expect(row.type).toBe("Warning");
    expect(row.reason).toBe("BackOff");
    expect(row.message).toBe("Back-off restarting failed container");
  });

  it("names the object the event is about as kind/name", () => {
    expect(mapEvent(event, NOW).object).toBe("Pod/api-0");
  });

  it("ages from lastTimestamp, not creation — that is what 'last seen' means", () => {
    expect(mapEvent(event, NOW).ageSeconds).toBe(120);
  });

  it("falls back through eventTime and creationTimestamp when lastTimestamp is absent", () => {
    const noLast = { ...event, lastTimestamp: undefined };
    expect(mapEvent({ ...noLast, eventTime: "2026-08-18T11:59:00.000Z" }, NOW).ageSeconds).toBe(60);
    expect(mapEvent(noLast, NOW).ageSeconds).toBe(3600);
  });

  it("defaults a missing count to 1", () => {
    const noCount = { ...event, count: undefined };
    expect(mapEvent(noCount, NOW).count).toBe(1);
  });

  it("treats anything that is not Warning as Normal", () => {
    expect(mapEvent({ ...event, type: "Normal" }, NOW).type).toBe("Normal");
    expect(mapEvent({ ...event, type: undefined }, NOW).type).toBe("Normal");
  });

  it("survives an event with almost nothing on it", () => {
    const row = mapEvent({ metadata: { name: "x" } }, NOW);
    expect(row.object).toBe("—");
    expect(row.reason).toBe("—");
    expect(row.namespace).toBe("default");
  });
});
