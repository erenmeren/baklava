import { describe, it, expect } from "vitest";
import { kafka } from "./index";

describe("kafka module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(kafka.id).toBe("kafka");
    expect(kafka.optionalDeps).toEqual(["kafkajs", "avsc"]);
    expect(kafka.catalog.id).toBe("kafka");
    expect(kafka.serverPackages).toEqual(["kafkajs", "avsc"]);
  });
  it("summarises a connection record", () => {
    const summary = kafka.summary({
      id: "x", tech: "kafka", name: "n", status: "ok", createdAt: 0,
      config: { clientId: "c", brokers: ["b1:9092", "b2:9092"], ssl: false },
    });
    expect(summary).toBe("b1:9092, b2:9092");
  });
  it("exposes secret keys and a probe", () => {
    expect(kafka.config.secretKeys).toContain("password");
    expect(typeof kafka.driver.probe).toBe("function");
  });
});
