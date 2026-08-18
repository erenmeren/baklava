import { describe, it, expect, afterEach, vi } from "vitest";
import { kubernetesProvider } from "./infra-providers";

const POD = { namespace: "payments", name: "api-0", status: "Running" };
const DEPLOYMENT = { namespace: "payments", name: "api", ready: "2/2" };
const SERVICE = { namespace: "payments", name: "api-svc", type: "ClusterIP" };

function stubCluster(rows: { pods?: unknown[]; deployments?: unknown[]; services?: unknown[] } = {}) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const key = url.includes("/pods")
      ? "pods"
      : url.includes("/deployments")
        ? "deployments"
        : "services";
    return new Response(JSON.stringify({ rows: rows[key] ?? [] }), { status: 200 });
  }) as typeof fetch;
  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// getJson memoizes per URL for 10s, so every test uses its own connection id.
let n = 0;
const freshId = () => `conn-${n++}`;

const ctx = { pathname: "/kubernetes/conn/pods" };

describe("kubernetesProvider", () => {
  let stub: ReturnType<typeof stubCluster>;
  afterEach(() => stub.restore());

  it("returns nothing for an empty query rather than listing the cluster", async () => {
    stub = stubCluster({ pods: [POD] });
    const out = await kubernetesProvider(freshId(), "  ", ctx);

    expect(out).toEqual([]);
    expect(stub.urls).toEqual([]);
  });

  it("deep-links a pod to its list page, scoped and pre-selected", async () => {
    stub = stubCluster({ pods: [POD] });
    const id = freshId();

    const out = await kubernetesProvider(id, "api", ctx);

    expect(out).toContainEqual(
      expect.objectContaining({
        label: "api-0",
        href: `/kubernetes/${id}/pods?ns=payments&select=api-0`,
      }),
    );
  });

  it("covers deployments and services too", async () => {
    stub = stubCluster({ deployments: [DEPLOYMENT], services: [SERVICE] });
    const id = freshId();

    const out = await kubernetesProvider(id, "api", ctx);
    const hrefs = out.map((o) => o.href);

    expect(hrefs).toContain(`/kubernetes/${id}/deployments?ns=payments&select=api`);
    expect(hrefs).toContain(`/kubernetes/${id}/services?ns=payments&select=api-svc`);
  });

  it("matches on the namespace as well as the name", async () => {
    stub = stubCluster({ pods: [POD] });
    const out = await kubernetesProvider(freshId(), "payments", ctx);

    expect(out).toHaveLength(1);
  });

  it("filters out what does not match", async () => {
    stub = stubCluster({ pods: [POD, { namespace: "kube-system", name: "coredns-1" }] });
    const out = await kubernetesProvider(freshId(), "coredns", ctx);

    expect(out.map((o) => o.label)).toEqual(["coredns-1"]);
  });

  it("survives a cluster that cannot be reached", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    stub = { urls: [], restore: () => { globalThis.fetch = original; } };

    await expect(kubernetesProvider(freshId(), "api", ctx)).resolves.toEqual([]);
  });

  it("encodes names that are not URL-safe", async () => {
    stub = stubCluster({ pods: [{ namespace: "a b", name: "x/y" }] });
    const id = freshId();

    const out = await kubernetesProvider(id, "x/y", ctx);

    expect(out[0].href).toBe(`/kubernetes/${id}/pods?ns=a%20b&select=x%2Fy`);
  });
});
