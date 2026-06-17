import { describe, it, expect } from "vitest";
import { OBJECT_PROVIDERS } from "./object-providers";

describe("OBJECT_PROVIDERS", () => {
  it("only the SQL techs expose providers", () => {
    expect(Object.keys(OBJECT_PROVIDERS).sort()).toEqual(["mysql", "postgres", "sqlserver"]);
  });
});
