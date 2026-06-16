import { describe, it, expect } from "vitest";
import { SERVER_EXTERNAL_PACKAGES } from "@/techs/server-packages.generated";
import { TECH_META_LIST } from "@/techs/meta-registry";

describe("server-packages.generated", () => {
  it("equals the deduped sorted union of module serverPackages", () => {
    const expected = [...new Set(TECH_META_LIST.flatMap((m) => m.serverPackages ?? []))].sort();
    expect([...SERVER_EXTERNAL_PACKAGES].sort()).toEqual(expected);
  });
  it("contains all packages previously hand-listed in next.config", () => {
    const required = ["dockerode","ssh2","kafkajs","avsc","pg","mysql2","mssql","tedious","@kubernetes/client-node","ioredis","mongodb"];
    for (const p of required) expect(SERVER_EXTERNAL_PACKAGES).toContain(p);
  });
});
