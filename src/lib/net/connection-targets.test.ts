import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "node:dns/promises";
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
      { source: "inline", kubeconfigYaml: "clusters:\n- name: c\n  cluster: { server: 'https://169.254.169.254:6443' }" },
      ["169.254.169.254"],
    ],
    ["docker", { mode: "tcp", host: "10.0.0.2", port: 2375 }, ["10.0.0.2"]],
  ])("%s", async (tech, cfg, hosts) => expect(await targetHostsOf(tech, cfg)).toEqual(hosts));

  // client-node parses with js-yaml, which honours merge keys; a literal read
  // of cluster.server saw nothing here while the driver connected to b.server.
  it("kubernetes: follows YAML merge keys the way the driver does", async () => {
    const yaml = [
      "base: &b",
      "  server: http://169.254.169.254/latest",
      "clusters:",
      "- name: c",
      "  cluster:",
      "    <<: *b",
      "contexts:",
      "- name: x",
      "  context: { cluster: c, user: u }",
      "users:",
      "- name: u",
      "  user: {}",
      "current-context: x",
    ].join("\n");
    expect(await targetHostsOf("kubernetes", { source: "inline", kubeconfigYaml: yaml })).toEqual(["169.254.169.254"]);
    expect(await egressRejection("kubernetes", { source: "inline", kubeconfigYaml: yaml })).not.toBeNull();
  });

  it("kubernetes: includes the cluster proxy-url host", async () => {
    const yaml = "clusters:\n- name: c\n  cluster: { server: 'https://10.0.0.1:6443', proxy-url: 'http://169.254.169.254:80' }";
    expect(await targetHostsOf("kubernetes", { source: "inline", kubeconfigYaml: yaml })).toEqual([
      "10.0.0.1",
      "169.254.169.254",
    ]);
  });

  it("kubernetes: a kubeconfig the driver can't load is rejected", async () => {
    const res = await egressRejection("kubernetes", { source: "inline", kubeconfigYaml: "clusters: [ {" });
    expect(res?.status).toBe(400);
  });
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

  // Fail closed: an unresolved name can't be judged, and could resolve to a
  // blocked range by the time the driver looks it up.
  it("refuses an unresolvable name", async () => {
    const res = await egressRejection("postgres", { host: "no-such-host.invalid" });
    expect(res?.status).toBe(400);
    expect((await res!.json()).error).toMatch(/could not resolve no-such-host\.invalid/i);
  });

});

describe("egressRejection: mongodb+srv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("judges the SRV targets, not the (A-record-less) SRV name", async () => {
    const srv = vi.spyOn(dns, "resolveSrv").mockResolvedValue([
      { name: "169.254.169.254", port: 27017, priority: 0, weight: 0 },
    ]);
    const res = await egressRejection("mongo", { uri: "mongodb+srv://cluster0.example.net/db" });
    expect(srv).toHaveBeenCalledWith("_mongodb._tcp.cluster0.example.net");
    expect(res?.status).toBe(400);
  });

  it("lets a good SRV target through", async () => {
    vi.spyOn(dns, "resolveSrv").mockResolvedValue([{ name: "10.0.0.7", port: 27017, priority: 0, weight: 0 }]);
    expect(await egressRejection("mongo", { uri: "mongodb+srv://cluster0.example.net/db" })).toBeNull();
  });
});
