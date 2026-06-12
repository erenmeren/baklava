import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoadTest } from "../run-load-test";

// Gated by vitest config: only runs when BAKLAVA_INTEGRATION=1 (needs Docker).
describe("K6DockerExecutor (integration)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [1, 2, 3] }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("runs k6 against a local server and returns structured results", async () => {
    const lines: string[] = [];
    const result = await runLoadTest(
      {
        name: "integration",
        target: { baseUrl: `http://localhost:${port}` },
        requests: [{ name: "list", path: "/", checks: { status: 200, bodyContains: "items" } }],
        profile: { type: "constant", vus: 2, duration: "3s" },
        thresholds: { p95: 2000, errorRate: 0.1 },
      },
      { onProgress: (p) => lines.push(p.line) },
    );

    expect(result.totalRequests).toBeGreaterThan(0);
    expect(result.requests[0].name).toBe("list");
    expect(result.passed).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });
});
