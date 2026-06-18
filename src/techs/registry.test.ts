import { describe, it, expect } from "vitest";
import { TECH_MODULES, TECH_MODULE_LIST, techById, requireTechModule } from "./registry";

const TECH_IDS = ["docker","kafka","postgres","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3","qdrant"] as const;

describe("registry", () => {
  it("has exactly one module per TechId", () => {
    expect(Object.keys(TECH_MODULES).sort()).toEqual([...TECH_IDS].sort());
  });
  it("each module's key matches its id", () => {
    for (const [key, mod] of Object.entries(TECH_MODULES)) expect(mod.id).toBe(key);
  });
  it("techById looks up by id; requireTechModule throws on unknown", () => {
    expect(techById.get("postgres")?.id).toBe("postgres");
    expect(() => requireTechModule("nope" as never)).toThrow();
  });
  it("list order matches catalog connection order", () => {
    expect(TECH_MODULE_LIST.map((m) => m.id)).toEqual([
      "docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3","qdrant",
    ]);
  });
});
