import { describe, it, expect } from "vitest";
import { OBJECT_PROVIDERS } from "./object-providers";

describe("OBJECT_PROVIDERS", () => {
  it("covers every tech whose objects have a detail route", () => {
    expect(Object.keys(OBJECT_PROVIDERS).sort()).toEqual([
      "docker",
      "kafka",
      "kubernetes",
      "minio",
      "mongo",
      "mysql",
      "postgres",
      "qdrant",
      "r2",
      "s3",
      "sqlserver",
    ]);
  });

  it("omits redis — its keys have no route to link to", () => {
    expect(OBJECT_PROVIDERS.redis).toBeUndefined();
  });

  it("includes kubernetes — its tables honour ?ns= and ?select=", () => {
    expect(OBJECT_PROVIDERS.kubernetes).toBeTypeOf("function");
  });
});
