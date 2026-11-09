import { describe, it, expect, vi } from "vitest";
import { resolveObjectKind } from "../kubernetes";
import { CrdNotFoundError, listCustomResources } from "./crds";
import type { KubernetesConfig } from "../types";

/**
 * A CRD identity in a yaml/describe/delete route (`<plural>.<group>`) or a CR
 * page URL (`/crd/<group>/<plural>`) must never become an API path on its own:
 * malformed input is refused before the cluster is asked anything, and
 * well-formed input resolves only through an installed CRD.
 */

const widgetCrd = {
  metadata: { name: "widgets.demo.baklava.dev" },
  spec: {
    group: "demo.baklava.dev",
    scope: "Namespaced",
    names: { kind: "Widget", plural: "widgets" },
    versions: [{ name: "v1", served: true, storage: true }],
  },
};

function fakeBundle(installed: Record<string, unknown>) {
  const read = vi.fn(async (spec: { metadata: { name: string } }) => {
    const crd = installed[spec.metadata.name];
    if (!crd) throw Object.assign(new Error("not found"), { code: 404 });
    return crd;
  });
  return { objects: { read } } as never as Parameters<typeof resolveObjectKind>[0] & {
    objects: { read: typeof read };
  };
}

describe("resolveObjectKind", () => {
  it("resolves built-in kinds from the static map without a cluster read", async () => {
    const b = fakeBundle({});
    await expect(resolveObjectKind(b, "horizontalpodautoscaler")).resolves.toEqual({
      apiVersion: "autoscaling/v2",
      kind: "HorizontalPodAutoscaler",
      namespaced: true,
    });
    await expect(resolveObjectKind(b, "ClusterRole")).resolves.toMatchObject({ namespaced: false });
    expect(b.objects.read).not.toHaveBeenCalled();
  });

  it("resolves an installed CRD to the CRD's own group/version/kind", async () => {
    const b = fakeBundle({ "widgets.demo.baklava.dev": widgetCrd });
    await expect(resolveObjectKind(b, "widgets.demo.baklava.dev")).resolves.toEqual({
      apiVersion: "demo.baklava.dev/v1",
      kind: "Widget",
      namespaced: true,
    });
  });

  it.each([
    "../../api/v1/secrets",
    "widgets.demo%2Fbaklava.dev",
    "widgets.demo/baklava.dev",
    "Widgets.Demo.Baklava.Dev",
    "widgets",
    "constructor",
    "__proto__",
    "widgets..dev",
  ])("refuses %s before touching the cluster", async (kind) => {
    const b = fakeBundle({ "widgets.demo.baklava.dev": widgetCrd });
    await expect(resolveObjectKind(b, kind)).rejects.toThrow(/Unsupported kind/);
    expect(b.objects.read).not.toHaveBeenCalled();
  });

  it("refuses a well-formed name that isn't an installed CRD", async () => {
    const b = fakeBundle({});
    await expect(resolveObjectKind(b, "secrets.core.example.io")).rejects.toThrow(/Unsupported kind/);
    expect(b.objects.read).toHaveBeenCalledTimes(1);
  });
});

describe("listCustomResources", () => {
  const cfg: KubernetesConfig = { source: "inline", kubeconfigYaml: "" };
  it.each([
    ["demo.baklava.dev", "../secrets"],
    ["demo%2Fbaklava.dev", "widgets"],
    ["DEMO.baklava.dev", "widgets"],
    ["..", "widgets"],
  ])("refuses group=%s plural=%s as not found, before building a client", async (group, plural) => {
    // An empty inline kubeconfig would throw a different error if it got that far.
    await expect(listCustomResources("x", cfg, group, plural, "demo")).rejects.toBeInstanceOf(CrdNotFoundError);
  });
});
