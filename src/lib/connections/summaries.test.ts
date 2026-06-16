import { describe, it, expect } from "vitest";
import { connectionSummaries } from "./summaries";
describe("connectionSummaries", () => {
  it("postgres summary unchanged", () => {
    const r = { id:"x", tech:"postgres" as const, name:"n", status:"ok" as const, createdAt:0,
      config:{ host:"h", port:5432, database:"d", user:"u", password:"p", ssl:false } };
    expect(connectionSummaries.postgres(r)).toBe("u@h:5432/d");
  });
  it("has a summary for every tech", () => {
    for (const id of ["docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3"])
      expect(typeof connectionSummaries[id as keyof typeof connectionSummaries]).toBe("function");
  });
});
