import { describe, it, expect } from "vitest";
import { TECH_CATALOG, TECH_CATEGORIES, getTech } from "./tech-catalog";

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
