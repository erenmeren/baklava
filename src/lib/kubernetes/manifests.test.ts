import { describe, it, expect } from "vitest";
import {
  describeChange,
  ManifestError,
  MAX_MANIFEST_DOCS,
  parseManifests,
  stripNoise,
} from "./manifests";
import { unifiedDiff } from "./line-diff";

const cm = (name: string, extra = "") =>
  `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\ndata:\n  a: "1"\n${extra}`;

describe("parseManifests", () => {
  it("splits multi-document YAML and skips empty documents", () => {
    const docs = parseManifests(`---\n${cm("one")}---\n---\n${cm("two")}`);
    expect(docs.map((d) => d.metadata.name)).toEqual(["one", "two"]);
  });

  it("rejects a document without kind, apiVersion or name", () => {
    expect(() => parseManifests("apiVersion: v1\nmetadata:\n  name: x\n")).toThrow(/missing kind/);
    expect(() => parseManifests("kind: ConfigMap\nmetadata:\n  name: x\n")).toThrow(/missing apiVersion/);
    expect(() => parseManifests("apiVersion: v1\nkind: ConfigMap\n")).toThrow(/metadata.name/);
  });

  it("reports YAML syntax errors as ManifestError", () => {
    expect(() => parseManifests("a: [1, 2\n")).toThrow(ManifestError);
  });

  it("rejects non-mapping documents, empty input and List kinds", () => {
    expect(() => parseManifests("- a\n- b\n")).toThrow(/mapping/);
    expect(() => parseManifests("---\n")).toThrow(/No Kubernetes objects/);
    expect(() => parseManifests("apiVersion: v1\nkind: List\nmetadata:\n  name: x\n")).toThrow(/not supported/);
  });

  it("caps the document count and the byte size", () => {
    const many = Array.from({ length: MAX_MANIFEST_DOCS + 1 }, (_, i) => cm(`c${i}`)).join("---\n");
    expect(() => parseManifests(many)).toThrow(/Too many documents/);
    expect(() => parseManifests(`# ${"x".repeat(513 * 1024)}\n${cm("big")}`)).toThrow(/larger than/);
  });

  it("refuses a values-less (redacted-looking) Secret", () => {
    expect(() =>
      parseManifests("apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\ntype: Opaque\n"),
    ).toThrow(/redacted/);
    expect(
      parseManifests("apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\nstringData:\n  k: v\n"),
    ).toHaveLength(1);
  });
});

describe("stripNoise", () => {
  it("drops server-managed metadata, status and the last-applied annotation", () => {
    const out = stripNoise({
      kind: "ConfigMap",
      metadata: {
        name: "x",
        uid: "u",
        resourceVersion: "1",
        generation: 2,
        creationTimestamp: "t",
        managedFields: [{}],
        annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{}" },
      },
      status: { phase: "x" },
    });
    expect(out).toEqual({ kind: "ConfigMap", metadata: { name: "x" } });
  });
});

describe("describeChange", () => {
  const live = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "x", resourceVersion: "1", uid: "a" },
    data: { a: "1" },
  };

  it("reports created when there is no live object", () => {
    const r = describeChange(null, live);
    expect(r.action).toBe("created");
    expect(r.diff).toContain("+kind: ConfigMap");
    expect(r.diff).not.toContain("resourceVersion");
  });

  it("reports unchanged when only noise differs", () => {
    const r = describeChange(live, { ...live, metadata: { name: "x", resourceVersion: "2", uid: "a" } });
    expect(r).toEqual({ action: "unchanged", diff: "" });
  });

  it("reports configured with a diff naming the changed key", () => {
    const r = describeChange(live, { ...live, data: { a: "1", b: "2" } });
    expect(r.action).toBe("configured");
    expect(r.diff).toContain('+  b: "2"');
  });

  it("never puts Secret values in the diff — keys and 'changed' only", () => {
    const sec = (data: Record<string, string>) => ({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "s" },
      data,
    });
    const r = describeChange(
      sec({ same: "U0FNRQ==", gone: "R09ORQ==", edited: "T0xE" }),
      sec({ same: "U0FNRQ==", edited: "TkVX", added: "QURE" }),
    );
    expect(r.action).toBe("configured");
    for (const v of ["U0FNRQ==", "R09ORQ==", "T0xE", "TkVX", "QURE"]) {
      expect(r.diff).not.toContain(v);
    }
    expect(r.diff).toContain("-  gone: (hidden)");
    expect(r.diff).toContain("+  edited: (hidden, changed)");
    expect(r.diff).toContain("+  added: (hidden)");
    expect(r.diff).not.toMatch(/[-+] {2}same/);

    const created = describeChange(null, sec({ k: "VkFM" }));
    expect(created.diff).not.toContain("VkFM");
    expect(created.diff).toContain("+  k: (hidden)");
  });
});

describe("unifiedDiff", () => {
  it("is empty for identical input", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n")).toBe("");
  });

  it("emits hunks with limited context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "L10");
    const d = unifiedDiff(before, after, 2);
    expect(d.split("\n")).toEqual([
      "@@ -9,5 +9,5 @@",
      " l8",
      " l9",
      "-l10",
      "+L10",
      " l11",
      " l12",
    ]);
  });

  it("handles a pure addition from empty", () => {
    expect(unifiedDiff("", "a\nb")).toBe("@@ -0,0 +1,2 @@\n+a\n+b");
  });
});
