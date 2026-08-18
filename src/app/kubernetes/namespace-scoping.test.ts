import { describe, it, expect, beforeEach, vi } from "vitest";
import type { KubernetesConfig } from "@/lib/connections/types";

/**
 * The workspace pages are server components: they are the only place that can
 * scope a list call, because a namespace-restricted kubeconfig cannot call the
 * cluster-wide list endpoints at all. Filtering rows in the browser (what the
 * table also does) is not a substitute.
 */
// The list functions return a bounded K8sList, not a bare array.
const empty = () => ({ rows: [], truncated: false, remaining: null });
const listPods = vi.fn(async () => empty());
const listDeployments = vi.fn(async () => empty());
const listServices = vi.fn(async () => empty());
const listConfigMaps = vi.fn(async () => empty());
const listSecrets = vi.fn(async () => empty());

vi.mock("@/lib/connections/kubernetes", () => ({
  listPods: (...a: unknown[]) => listPods(...(a as [])),
  listDeployments: (...a: unknown[]) => listDeployments(...(a as [])),
  listServices: (...a: unknown[]) => listServices(...(a as [])),
  listConfigMaps: (...a: unknown[]) => listConfigMaps(...(a as [])),
  listSecrets: (...a: unknown[]) => listSecrets(...(a as [])),
  listNamespaces: vi.fn(async () => empty()),
}));

let config: KubernetesConfig = { source: "path" };
vi.mock("@/lib/connections/server", () => ({
  requireConnection: () => ({ id: "conn-1", tech: "kubernetes", name: "prod", config }),
}));

// The views render row tables; the pages only need to hand them data, so the
// JSX is irrelevant here — stub it away to keep this a server-project test.
vi.mock("./[connectionId]/pods/pods-view", () => ({ PodsView: () => null }));
vi.mock("./[connectionId]/deployments/deployments-view", () => ({ DeploymentsView: () => null }));
vi.mock("./[connectionId]/services/services-view", () => ({ ServicesView: () => null }));
vi.mock("./[connectionId]/configmaps/configmaps-view", () => ({ ConfigMapsView: () => null }));
vi.mock("./[connectionId]/secrets/secrets-view", () => ({ SecretsView: () => null }));
vi.mock("./[connectionId]/load-error", () => ({ LoadError: () => null }));

const PAGES = [
  { name: "pods", load: () => import("./[connectionId]/pods/page"), spy: listPods },
  { name: "deployments", load: () => import("./[connectionId]/deployments/page"), spy: listDeployments },
  { name: "services", load: () => import("./[connectionId]/services/page"), spy: listServices },
  { name: "configmaps", load: () => import("./[connectionId]/configmaps/page"), spy: listConfigMaps },
  { name: "secrets", load: () => import("./[connectionId]/secrets/page"), spy: listSecrets },
];

async function renderPage(
  load: () => Promise<{ default: (props: never) => Promise<unknown> }>,
  search: Record<string, string> = {},
) {
  const mod = await load();
  await mod.default({
    params: Promise.resolve({ connectionId: "conn-1" }),
    searchParams: Promise.resolve(search),
  } as never);
}

describe("kubernetes pages scope their list call to the selected namespace", () => {
  beforeEach(() => {
    config = { source: "path" };
    for (const p of PAGES) p.spy.mockClear();
  });

  for (const page of PAGES) {
    it(`${page.name}: passes the ?ns= namespace to the driver`, async () => {
      await renderPage(page.load, { ns: "payments" });
      expect(page.spy).toHaveBeenCalledWith("conn-1", expect.anything(), "payments");
    });

    it(`${page.name}: falls back to the connection's configured namespace`, async () => {
      config = { source: "path", namespace: "billing" };
      await renderPage(page.load);
      expect(page.spy).toHaveBeenCalledWith("conn-1", expect.anything(), "billing");
    });

    it(`${page.name}: asks for all namespaces when nothing is configured`, async () => {
      await renderPage(page.load);
      expect(page.spy).toHaveBeenCalledWith("conn-1", expect.anything(), "*");
    });

    it(`${page.name}: lets ?ns=* widen a configured namespace`, async () => {
      config = { source: "path", namespace: "billing" };
      await renderPage(page.load, { ns: "*" });
      expect(page.spy).toHaveBeenCalledWith("conn-1", expect.anything(), "*");
    });
  }
});
