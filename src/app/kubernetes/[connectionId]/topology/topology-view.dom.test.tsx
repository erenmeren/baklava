import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TopologyView, VIEW_KEY } from "./topology-view";
import { K8sContextProvider, type K8sContextValue } from "../k8s-context";
import type { ClusterTopologyResult } from "@/lib/connections/kubernetes/topology";
import type { TopologyWorkload } from "@/lib/kubernetes/topology";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/kubernetes/conn-1/topology",
  useSearchParams: () => new URLSearchParams(),
}));

const ctx: K8sContextValue = {
  connectionId: "conn-1",
  namespace: "*",
  setNamespace: vi.fn(),
  namespaces: [],
  filter: "",
  setFilter: vi.fn(),
  setFilterOpen: vi.fn(),
  setCommandOpen: vi.fn(),
  setHelpOpen: vi.fn(),
  context: "k3s",
  serverVersion: "v1.31",
};

const storefront: TopologyWorkload = {
  kind: "Deployment",
  namespace: "demo",
  name: "storefront",
  replicas: 2,
  cpuPerPod: 12,
  memPerPod: 32 * 1024 ** 2,
  problem: false,
  pods: [
    { namespace: "demo", name: "storefront-a", phase: "Running", problem: null, cpuMillicores: 12, memBytes: 32 * 1024 ** 2 },
    { namespace: "demo", name: "storefront-b", phase: "Running", problem: null, cpuMillicores: 12, memBytes: 32 * 1024 ** 2 },
  ],
};

const TOPOLOGY: ClusterTopologyResult = {
  nodes: [
    {
      name: "cp-1",
      role: "control-plane",
      ready: true,
      cpu: { used: 400, allocatable: 2000, pct: 20 },
      mem: { used: 1024 ** 3, allocatable: 4 * 1024 ** 3, pct: 25 },
      podCount: 2,
      workloads: [storefront],
    },
  ],
  unscheduled: [],
  summary: { nodes: 1, controlPlane: 1, workers: 0, pods: 2, cpuPct: 20, memPct: 25 },
  notes: [],
  metricsMissing: false,
  namespace: "*",
};

function renderView(t: ClusterTopologyResult = TOPOLOGY) {
  return render(
    <K8sContextProvider value={ctx}>
      <TopologyView topology={t} />
    </K8sContextProvider>,
  );
}

describe("TopologyView", () => {
  beforeEach(() => localStorage.clear());

  it("expands and collapses a node card", () => {
    renderView();
    const card = screen.getByRole("button", { name: /cp-1 control-plane/ });
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("storefront")).toBeNull();

    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    const row = screen.getByRole("row", { name: /storefront/ });
    expect(row).toHaveAttribute("href", "/kubernetes/conn-1/deployments?ns=demo&select=storefront");

    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("storefront")).toBeNull();
  });

  it("toggles to the orbit view, remembers it, and opens a node's panel on click", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Orbit" }));
    expect(localStorage.getItem(VIEW_KEY)).toBe("orbit");
    expect(screen.getByRole("img", { name: "cluster orbit" })).toBeInTheDocument();

    const panel = screen.getByRole("complementary", { name: "node details" });
    expect(within(panel).getByText(/click a node/i)).toBeInTheDocument();
    const node = screen.getByRole("button", { name: /cp-1 control-plane/ });
    fireEvent.click(node);
    expect(node).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByText("cp-1")).toBeInTheDocument();
    expect(within(panel).getByText("×2")).toBeInTheDocument();

    fireEvent.keyDown(node, { key: "Enter" });
    expect(node).toHaveAttribute("aria-pressed", "false");
  });

  it("starts in the remembered view", () => {
    localStorage.setItem(VIEW_KEY, "orbit");
    renderView();
    expect(screen.getByRole("button", { name: "Orbit" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "cluster orbit" })).toBeInTheDocument();
  });

  it("says when metrics-server is missing and hides percentages", () => {
    renderView({
      ...TOPOLOGY,
      metricsMissing: true,
      nodes: [{ ...TOPOLOGY.nodes[0], cpu: null, mem: null }],
      summary: { ...TOPOLOGY.summary, cpuPct: null, memPct: null },
    });
    expect(screen.getByText(/metrics-server not installed/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });
});
