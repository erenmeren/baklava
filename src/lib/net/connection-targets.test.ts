import { describe, it, expect } from "vitest";
import { egressRejection, targetHostsOf } from "./connection-targets";

describe("targetHostsOf", () => {
  it.each<[Parameters<typeof targetHostsOf>[0], unknown, string[]]>([
    ["postgres", { host: "db.internal", port: 5432 }, ["db.internal"]],
    ["redis", { mode: "cluster", nodes: "a:7000, b:7001" }, ["a", "b"]],
    ["kafka", { brokers: ["k1:9092", "[::1]:9093"], schemaRegistryUrl: "http://sr:8081" }, ["k1", "::1", "sr"]],
    ["mongo", { uri: "mongodb://u:p@m1:27017,m2:27018/db?replicaSet=rs" }, ["m1", "m2"]],
    ["mongo", { uri: "mongodb+srv://cluster0.example.net/db" }, ["cluster0.example.net"]],
    ["qdrant", { url: "https://q.example:6333" }, ["q.example"]],
    ["minio", { endpoint: "minio.lan:9000" }, ["minio.lan"]],
    [
      "kubernetes",
      { source: "inline", kubeconfigYaml: "clusters:\n- cluster: { server: 'https://169.254.169.254:6443' }" },
      ["169.254.169.254"],
    ],
    ["docker", { mode: "tcp", host: "10.0.0.2", port: 2375 }, ["10.0.0.2"]],
  ])("%s", (tech, cfg, hosts) => expect(targetHostsOf(tech, cfg)).toEqual(hosts));
});

describe("egressRejection", () => {
  it("refuses a metadata target, 400", async () => {
    const res = await egressRejection("postgres", { host: "169.254.169.254", port: 5432 });
    expect(res?.status).toBe(400);
  });

  it("refuses a metadata broker hidden among good ones", async () => {
    expect(await egressRejection("kafka", { brokers: ["10.0.0.1:9092", "169.254.169.254:80"] })).not.toBeNull();
  });

  it("lets private / loopback targets through", async () => {
    expect(await egressRejection("postgres", { host: "127.0.0.1" })).toBeNull();
    expect(await egressRejection("mysql", { host: "192.168.1.20" })).toBeNull();
  });

  it("leaves an unresolvable name for the driver to report", async () => {
    expect(await egressRejection("postgres", { host: "no-such-host.invalid" })).toBeNull();
  });
});
