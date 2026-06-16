import { describe, it, expect } from "vitest";
import { FIRST_PAGE, workspaceHref } from "./first-page";
describe("FIRST_PAGE", () => {
  it("known initial sections", () => {
    expect(FIRST_PAGE.docker).toBe("containers");
    expect(FIRST_PAGE.redis).toBe("keys");
    expect(FIRST_PAGE.mongo).toBe("databases");
    expect(FIRST_PAGE.postgres).toBe("");
  });
  it("workspaceHref", () => {
    expect(workspaceHref("docker","id1")).toBe("/docker/id1/containers");
    expect(workspaceHref("postgres","id1")).toBe("/postgres/id1");
  });
});
