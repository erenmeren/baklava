import { describe, it, expect } from "vitest";
import { involvedObjectSelector } from "./field-selector";

describe("involvedObjectSelector", () => {
  it("selects the events of one object", () => {
    expect(involvedObjectSelector("Pod", "api-0")).toBe(
      "involvedObject.kind=Pod,involvedObject.name=api-0",
    );
  });

  it("refuses a name carrying selector syntax, which would widen the match", () => {
    expect(() => involvedObjectSelector("Pod", "api-0,involvedObject.namespace=other")).toThrow(
      /name/i,
    );
    expect(() => involvedObjectSelector("Pod", "api=0")).toThrow(/name/i);
  });

  it("accepts the characters Kubernetes actually allows in a name", () => {
    expect(involvedObjectSelector("Pod", "api-0.sub_x")).toContain("api-0.sub_x");
  });

  it("refuses a bogus kind for the same reason", () => {
    expect(() => involvedObjectSelector("Pod,x=y", "api-0")).toThrow(/kind/i);
  });
});
