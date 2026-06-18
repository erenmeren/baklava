import { describe, it, expect } from "vitest";
import { qdrant } from "./index";
describe("qdrant module", () => {
  it("declares id, optionalDeps, category", () => {
    expect(qdrant.id).toBe("qdrant");
    expect(qdrant.optionalDeps).toEqual(["@qdrant/js-client-rest"]);
    expect(qdrant.serverPackages).toBeUndefined();
    expect(qdrant.catalog.category).toBe("Vector");
    expect(qdrant.capabilities?.vectorSearch).toBe(true);
  });
  it("summarises the URL host, safely", () => {
    const r = { id: "x", tech: "qdrant" as const, name: "n", status: "ok" as const, createdAt: 0, config: { url: "http://localhost:6333" } };
    expect(qdrant.summary(r)).toBe("localhost:6333");
    expect(qdrant.summary({ ...r, config: { url: "not a url" } })).toBe("not a url");
  });
});
