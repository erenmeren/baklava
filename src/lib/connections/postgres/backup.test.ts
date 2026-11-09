import { describe, it, expect, vi } from "vitest";

// A quoted identifier may contain a newline; written raw into a `-- …` line it
// would end the comment and plant SQL that runs on restore.
const EVIL = "x\nDROP TABLE victim; --";
const EVIL_CR = "y\rDROP TABLE victim2; --";

vi.mock("./internal", async (orig) => ({
  ...(await orig<typeof import("./internal")>()),
  buildClientConfig: () => ({}),
  getPg: async () => ({
    Client: class {
      async connect() {}
      async end() {}
      async query(q: string | { text: string }) {
        const text = typeof q === "string" ? q : q.text;
        if (text.includes("from pg_namespace")) return { rows: [{ nspname: EVIL }] };
        if (text.includes("pg_sequences")) return { rows: [] };
        if (text.includes("from pg_class")) return { rows: [{ relname: EVIL_CR }] };
        if (text.startsWith("SELECT ")) return { rows: [["1"]] };
        return { rows: [] };
      }
    },
  }),
}));
vi.mock("./catalog", () => ({
  listColumns: async () => [{ name: "id", dataType: "int", isNullable: true, default: null }],
  listConstraints: async () => [],
  listIndexes: async () => [],
}));

import { streamDatabaseDump } from "./backup";

describe("streamDatabaseDump comment lines", () => {
  it("never lets an identifier break out of a `--` comment", async () => {
    const cfg = { host: "h", port: 5432, database: "d", user: "u", password: "p", ssl: false };
    let out = "";
    for await (const chunk of streamDatabaseDump(cfg, "db\r\nDROP TABLE db; --")) out += chunk;
    // Newlines inside "quoted identifiers" are legal SQL; outside them every
    // DROP must sit on a comment line.
    const unquoted = out.replace(/"(?:[^"]|"")*"/g, '""');
    for (const line of unquoted.split(/\r\n|\r|\n/)) {
      if (line.includes("DROP TABLE")) expect(line.startsWith("--")).toBe(true);
    }
    expect(out).toContain("-- data ");
  });
});
