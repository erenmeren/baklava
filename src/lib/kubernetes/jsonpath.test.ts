import { describe, it, expect } from "vitest";
import { evalJsonPath, parseJsonPath } from "./jsonpath";

const obj = {
  spec: { size: 3, color: "red", ports: [{ port: 80 }, { port: 443 }], flag: false },
  metadata: { labels: { "app.kubernetes.io/name": "web" } },
};

describe("evalJsonPath", () => {
  it("follows dotted keys and array indexes", () => {
    expect(evalJsonPath(obj, ".spec.size")).toBe(3);
    expect(evalJsonPath(obj, ".spec.ports[1].port")).toBe(443);
    expect(evalJsonPath(obj, ".spec.flag")).toBe(false);
  });

  it("accepts the {…} template form and quoted keys", () => {
    expect(evalJsonPath(obj, "{.spec.color}")).toBe("red");
    expect(evalJsonPath(obj, ".metadata.labels['app.kubernetes.io/name']")).toBe("web");
  });

  it("is undefined for missing paths and out-of-range indexes", () => {
    expect(evalJsonPath(obj, ".spec.nope.deeper")).toBeUndefined();
    expect(evalJsonPath(obj, ".spec.ports[5].port")).toBeUndefined();
    expect(evalJsonPath(obj, ".spec.size[0]")).toBeUndefined();
  });

  it("refuses unsupported syntax rather than guessing", () => {
    for (const p of [
      ".spec.ports[*].port",
      "..port",
      ".spec.ports[?(@.port==80)]",
      "spec.size",
      ".spec.ports[-1]",
      ".spec.size,.spec.color",
      "",
    ]) {
      expect(parseJsonPath(p)).toBeNull();
      expect(evalJsonPath(obj, p)).toBeUndefined();
    }
  });

  it("never walks into inherited properties", () => {
    expect(evalJsonPath(obj, ".__proto__")).toBeUndefined();
    expect(evalJsonPath(obj, ".spec.constructor")).toBeUndefined();
    expect(evalJsonPath(obj, ".spec.ports.length")).toBeUndefined();
  });
});
