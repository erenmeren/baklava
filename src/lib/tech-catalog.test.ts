import { describe, it, expect } from "vitest";
import { TECH_CATALOG, TECH_CATEGORIES, getTech } from "./tech-catalog";

describe("TECH_CATALOG", () => {
  it("includes all 11 techs + loadtest tool", () => {
    const ids = TECH_CATALOG.map((t) => t.id);
    for (const id of ["docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3","loadtest"]) expect(ids).toContain(id);
  });
  it("loadtest is a tool; postgres is a connection", () => {
    expect(getTech("loadtest")?.kind).toBe("tool");
    expect(getTech("postgres")?.kind).toBeUndefined();
  });
});

describe("loadtest catalog entry", () => {
  it("registers a Load Testing tech in the Testing category", () => {
    const lt = getTech("loadtest");
    expect(lt).toBeDefined();
    expect(lt?.name).toBe("Load Testing");
    expect(lt?.category).toBe("Testing");
    expect(lt?.status).toBe("available");
  });

  it("includes Testing in the category list", () => {
    expect(TECH_CATEGORIES).toContain("Testing");
  });

  it("loadtest appears exactly once in the catalog", () => {
    expect(TECH_CATALOG.filter((t) => t.id === "loadtest")).toHaveLength(1);
  });
});
