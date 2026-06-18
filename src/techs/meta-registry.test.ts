import { describe, it, expect } from "vitest";
import { TECH_META, TECH_META_LIST, techMetaById, requireTechMeta } from "./meta-registry";

const TECH_IDS = ["docker","kafka","postgres","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3","qdrant"] as const;

describe("meta-registry", () => {
  it("has one meta per TechId", () => {
    expect(Object.keys(TECH_META).sort()).toEqual([...TECH_IDS].sort());
  });
  it("each meta's key matches its id", () => {
    for (const [key, m] of Object.entries(TECH_META)) expect(m.id).toBe(key);
  });
  it("lookup + require", () => {
    expect(techMetaById.get("postgres")?.id).toBe("postgres");
    expect(() => requireTechMeta("nope" as never)).toThrow();
  });
  it("list order matches catalog connection order", () => {
    expect(TECH_META_LIST.map((m) => m.id)).toEqual([
      "docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3","qdrant",
    ]);
  });
});
