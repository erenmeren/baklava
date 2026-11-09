import { describe, it, expect } from "vitest";
import { crdIdentity, crdName, mapCrd, mapCustomResource, parseCrdName } from "./crd";

const NOW = new Date("2026-08-18T12:00:00.000Z");
const AN_HOUR_AGO = "2026-08-18T11:00:00.000Z";

const widgetCrd = {
  metadata: { name: "widgets.demo.baklava.dev", creationTimestamp: AN_HOUR_AGO },
  spec: {
    group: "demo.baklava.dev",
    scope: "Namespaced",
    names: { kind: "Widget", plural: "widgets" },
    versions: [
      { name: "v1beta1", served: true, storage: false },
      {
        name: "v1",
        served: true,
        storage: true,
        additionalPrinterColumns: [
          { name: "Color", type: "string", jsonPath: ".spec.color" },
          { name: "Size", type: "integer", jsonPath: ".spec.size" },
          { name: "Debug", type: "string", jsonPath: ".spec.debug", priority: 1 },
          { name: "Age", type: "date", jsonPath: ".metadata.creationTimestamp" },
          { name: "Seen", type: "date", jsonPath: ".status.lastSeen" },
          { name: "Ports", type: "string", jsonPath: ".spec.ports[*].port" },
        ],
      },
    ],
  },
};

describe("CRD identity validation", () => {
  it("accepts a real CRD name", () => {
    expect(crdName("demo.baklava.dev", "widgets")).toBe("widgets.demo.baklava.dev");
    expect(parseCrdName("widgets.demo.baklava.dev")).toEqual({
      plural: "widgets",
      group: "demo.baklava.dev",
    });
  });

  it("rejects anything that could steer an API path", () => {
    for (const [group, plural] of [
      ["demo.baklava.dev", "../secrets"],
      ["..", "widgets"],
      ["demo%2Fbaklava.dev", "widgets"],
      ["demo/baklava.dev", "widgets"],
      ["Demo.Baklava.dev", "widgets"],
      ["demo.baklava.dev", "Widgets"],
      ["nodot", "widgets"],
      ["demo.baklava.dev", ""],
      ["demo.baklava.dev", "a?b"],
      [`${"a".repeat(250)}.io`, "widgets"],
    ]) {
      expect(crdName(group, plural)).toBeNull();
    }
    for (const kind of ["pod", "../x.io", "widgets.demo%2Fx.io", "Widgets.demo.io", ".demo.io", "widgets."]) {
      expect(parseCrdName(kind)).toBeNull();
    }
  });
});

describe("crdIdentity", () => {
  it("talks to the served storage version and keeps default-priority columns minus Age", () => {
    const id = crdIdentity(widgetCrd)!;
    expect(id).toMatchObject({ group: "demo.baklava.dev", plural: "widgets", version: "v1", kind: "Widget", namespaced: true });
    expect(id.columns.map((c) => c.name)).toEqual(["Color", "Size", "Seen", "Ports"]);
  });

  it("falls back to the first served version when storage isn't served", () => {
    const crd = {
      ...widgetCrd,
      spec: { ...widgetCrd.spec, versions: [{ name: "v2", served: true }, { name: "v1", served: false, storage: true }] },
    };
    expect(crdIdentity(crd)!.version).toBe("v2");
  });

  it("is null when nothing is served or the CRD's own names are malformed", () => {
    expect(crdIdentity({ ...widgetCrd, spec: { ...widgetCrd.spec, versions: [{ name: "v1", served: false }] } })).toBeNull();
    expect(crdIdentity({ ...widgetCrd, spec: { ...widgetCrd.spec, group: "../x" } })).toBeNull();
  });

  it("marks cluster scope", () => {
    expect(crdIdentity({ ...widgetCrd, spec: { ...widgetCrd.spec, scope: "Cluster" } })!.namespaced).toBe(false);
  });
});

describe("mapCrd / mapCustomResource", () => {
  it("summarizes a CRD with the storage version starred", () => {
    expect(mapCrd(widgetCrd, NOW)).toEqual({
      name: "widgets.demo.baklava.dev",
      group: "demo.baklava.dev",
      kind: "Widget",
      plural: "widgets",
      scope: "Namespaced",
      versions: "v1beta1,v1*",
      ageSeconds: 3600,
    });
  });

  it("fills printer-column cells, ages dates, and dashes the unsupported or missing", () => {
    const { columns } = crdIdentity(widgetCrd)!;
    const row = mapCustomResource(
      {
        metadata: { name: "small-blue", namespace: "demo", creationTimestamp: AN_HOUR_AGO },
        spec: { color: "blue", size: 1, ports: [{ port: 80 }] },
        status: { lastSeen: "2026-08-18T11:58:00.000Z" },
      } as never,
      columns,
      NOW,
    );
    expect(row).toEqual({ namespace: "demo", name: "small-blue", cells: ["blue", "1", "2m", "—"], ageSeconds: 3600 });
  });

  it("leaves namespace off a cluster-scoped instance", () => {
    expect(mapCustomResource({ metadata: { name: "x" } }, [], NOW)).not.toHaveProperty("namespace");
  });
});
