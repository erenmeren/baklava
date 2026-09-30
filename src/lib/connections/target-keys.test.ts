import { describe, it, expect } from "vitest";
import { changedTargetKeys } from "./target-keys";

const pg = { host: "db.internal", port: 5432, database: "app", user: "u", password: "s", ssl: true };

describe("changedTargetKeys", () => {
  it("flags a new host / port / TLS downgrade", () => {
    expect(changedTargetKeys(pg, { config: { host: "evil.example" } })).toEqual(["host"]);
    expect(changedTargetKeys(pg, { config: { port: 6543, ssl: false } })).toEqual(["port", "ssl"]);
    expect(changedTargetKeys({ brokers: ["a:9092"] }, { config: { brokers: ["evil:9092"] } })).toEqual([
      "brokers",
    ]);
  });

  it("ignores unchanged values and non-target keys", () => {
    expect(changedTargetKeys(pg, { config: { host: "db.internal", database: "other", password: "" } })).toEqual([]);
  });

  it("treats an absent optional field and its empty/false form as the same", () => {
    expect(changedTargetKeys({ host: "h" }, { config: { host: "h", tls: false, schemaRegistryUrl: "" } })).toEqual([]);
  });

  it("counts unsetting a target key", () => {
    expect(changedTargetKeys(pg, { unset: ["ssl"] })).toEqual(["ssl"]);
    expect(changedTargetKeys(pg, { unset: ["sessionToken"] })).toEqual([]);
  });
});
