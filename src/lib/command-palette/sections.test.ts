import { describe, it, expect } from "vitest";
import { TECH_SECTIONS } from "./sections";
import { TECH_CATALOG } from "@/lib/tech-catalog";

describe("TECH_SECTIONS", () => {
  it("has a non-empty entry for every available tech", () => {
    for (const t of TECH_CATALOG.filter((t) => t.status === "available")) {
      expect(TECH_SECTIONS[t.id as keyof typeof TECH_SECTIONS]?.length, t.id).toBeGreaterThan(0);
    }
  });
  it("every section has a label and a string seg", () => {
    for (const list of Object.values(TECH_SECTIONS)) {
      for (const s of list) {
        expect(typeof s.seg).toBe("string");
        expect(s.label.length).toBeGreaterThan(0);
      }
    }
  });
});
