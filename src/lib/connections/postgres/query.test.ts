import { describe, it, expect, vi } from "vitest";

const sent: unknown[] = [];
vi.mock("./client", () => ({
  withClient: async (_cfg: unknown, _db: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (q: unknown) => {
        sent.push(q);
        return { rows: [], fields: [], rowCount: 0 };
      },
    }),
}));

import { runReadOnlyQuery } from "./query";

describe("runReadOnlyQuery", () => {
  it("sends the user's statement over the extended protocol (one statement only)", async () => {
    const cfg = { host: "h", port: 5432, database: "d", user: "u", password: "p", ssl: false };
    await runReadOnlyQuery(cfg, "d", "SELECT 1");
    const user = sent.find((q) => typeof q === "object" && (q as { text?: string }).text === "SELECT 1");
    // queryMode "extended" makes pg Parse/Bind/Execute; Parse refuses a second
    // statement, so a guard bypass can't `COMMIT` out of the READ ONLY txn.
    expect(user).toMatchObject({ queryMode: "extended", rowMode: "array" });
    expect(sent).toContain("SET LOCAL statement_timeout = '30s'");
  });
});
