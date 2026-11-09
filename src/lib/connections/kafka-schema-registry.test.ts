import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SchemaRegistryClient } from "./kafka-schema-registry";

// The registry URL is egress-checked; a 3xx would let it bounce the server
// (with the basic-auth header) to a host that never was.
describe("SchemaRegistryClient redirects", () => {
  let targetHits = 0;
  const target = http.createServer((_req, res) => {
    targetHits++;
    res.end("[]");
  });
  const redirector = http.createServer((_req, res) => {
    const { port } = target.address() as AddressInfo;
    res.writeHead(302, { location: `http://127.0.0.1:${port}/subjects` }).end();
  });
  const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
  afterAll(() => {
    target.close();
    redirector.close();
  });

  it("does not follow a redirect", async () => {
    await listen(target);
    const port = await listen(redirector);
    const client = new SchemaRegistryClient({ url: `http://127.0.0.1:${port}` });
    await expect(client.listSubjects()).rejects.toThrow(/HTTP 302/);
    await expect(client.getSchema(1)).rejects.toThrow(/HTTP 302/);
    expect(targetHits).toBe(0);
  });
});
