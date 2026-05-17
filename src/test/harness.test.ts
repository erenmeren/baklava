import { describe, it, expect } from "vitest";
import { makeConnection, KAFKA_SAMPLE_CONFIG } from "./factories";

// Smoke test: verifies the vitest harness, path aliases, and factories
// are all wired up correctly. If this passes, the test infrastructure
// is functional.
describe("test harness", () => {
  it("can import via the @/ path alias", async () => {
    const types = await import("@/lib/connections/types");
    expect(typeof types).toBe("object");
  });

  it("factories produce well-formed connection records", () => {
    const conn = makeConnection("kafka", KAFKA_SAMPLE_CONFIG);
    expect(conn.tech).toBe("kafka");
    expect(conn.config.sasl?.password).toBe("secret-kafka-pw");
    expect(conn.id).toMatch(/^kafka-/);
    expect(conn.status).toBe("ok");
  });

  it("each call produces a unique id", () => {
    const a = makeConnection("postgres", {});
    const b = makeConnection("postgres", {});
    expect(a.id).not.toBe(b.id);
  });

  it("overrides take precedence", () => {
    const conn = makeConnection("docker", {}, { id: "fixed", status: "error" });
    expect(conn.id).toBe("fixed");
    expect(conn.status).toBe("error");
  });
});
