import { describe, it, expect } from "vitest";
import { probeHealth } from "./health";
import type { ConnectionRecord } from "./types";

describe("health probe egress", () => {
  it("reports down for a metadata-IP endpoint instead of connecting", async () => {
    const conn = {
      id: "x",
      tech: "etcd" as ConnectionRecord["tech"],
      name: "meta",
      config: { host: "169.254.169.254", port: 80 },
      status: "untested",
      createdAt: 1,
    } as unknown as ConnectionRecord;
    const snap = await probeHealth(conn);
    expect(snap.status).toBe("down");
    expect(snap.error ?? "").toMatch(/blocked|metadata/i);
  });
});
