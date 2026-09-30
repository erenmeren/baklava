import { describe, it, expect } from "vitest";
import { backupSqlServerDatabase } from "./sqlserver/backup";

const cfg = { host: "127.0.0.1", port: 1, database: "x", user: "u", password: "p", encrypt: false, trustServerCertificate: true };

describe("backupSqlServerDatabase path", () => {
  it.each(["\\\\evil\\share\\db.bak", "//evil/share/db.bak", " \\\\evil\\share\\db.bak"])(
    "refuses the UNC path %s before connecting",
    async (path) => {
      await expect(backupSqlServerDatabase(cfg, "demo", path)).rejects.toThrow(/UNC/);
    },
  );
});
