import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/store", () => ({ getConnection: vi.fn() }));
vi.mock("@/lib/connections/health", () => ({ probeHealth: vi.fn() }));

import { getConnection } from "@/lib/connections/store";
import { probeHealth } from "@/lib/connections/health";
import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/dashboard/[id]/health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s when the connection is unknown", async () => {
    vi.mocked(getConnection).mockReturnValue(undefined);
    const res = await GET(new Request("http://x") as never, ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns the snapshot for a known connection", async () => {
    vi.mocked(getConnection).mockReturnValue({ id: "c1", tech: "postgres", config: {} } as never);
    vi.mocked(probeHealth).mockResolvedValue({ status: "ok", latencyMs: 9, summary: "x", metrics: [] } as never);
    const res = await GET(new Request("http://x") as never, ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", latencyMs: 9 });
  });
});
