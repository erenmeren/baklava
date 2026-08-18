import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { K8sContextProvider, type K8sContextValue } from "./k8s-context";
import { ResourceTable, type Column } from "./resource-table";

// ResourceTable calls `router.refresh()` after a mutation so the server
// components that rendered the rows re-run. No App Router is mounted here.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

interface Row {
  name: string;
  namespace: string;
  status: string;
}

const ROWS: Row[] = [
  { name: "api-0", namespace: "payments", status: "Running" },
  { name: "api-1", namespace: "payments", status: "Running" },
];

const COLUMNS: Column<Row>[] = [
  { label: "namespace", width: "w-32", cell: (r) => r.namespace, value: (r) => r.namespace },
  { label: "name", width: "w-72", cell: (r) => r.name, value: (r) => r.name },
  { label: "status", width: "w-24", cell: (r) => r.status, value: (r) => r.status },
];

const CTX: K8sContextValue = {
  connectionId: "conn-1",
  namespace: "*",
  setNamespace: () => {},
  namespaces: ["payments"],
  filter: "",
  setFilter: () => {},
  setFilterOpen: () => {},
  setCommandOpen: () => {},
  setHelpOpen: () => {},
  context: "kind-kind",
  serverVersion: "v1.31.0",
};

function renderTable() {
  return render(
    <K8sContextProvider value={CTX}>
      <ResourceTable
        resource="Pods"
        kind="pod"
        rows={ROWS}
        columns={COLUMNS}
        actions={{ delete: true }}
      />
    </K8sContextProvider>,
  );
}

/** Open the delete confirmation for the currently selected row. */
function pressDelete() {
  fireEvent.keyDown(window, { key: "D" });
}

describe("ResourceTable delete action", () => {
  let restore: () => void;
  beforeEach(() => {
    refresh.mockClear();
    restore = mockFetch({ "/yaml/": { ok: true } });
  });
  afterEach(() => restore());

  it("calls the resource DELETE endpoint for the selected row", async () => {
    renderTable();
    pressDelete();

    fireEvent.click(await screen.findByRole("button", { name: /delete api-0/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(url).toBe("/api/kubernetes/conn-1/yaml/pod/api-0?namespace=payments");
  });

  it("refreshes the route so the deleted row disappears", async () => {
    renderTable();
    pressDelete();
    fireEvent.click(await screen.findByRole("button", { name: /delete api-0/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("closes the confirmation once the delete succeeds", async () => {
    renderTable();
    pressDelete();
    fireEvent.click(await screen.findByRole("button", { name: /delete api-0/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /delete api-0/i })).toBeNull(),
    );
  });

  it("keeps the dialog open and shows the error when the delete fails", async () => {
    restore();
    restore = mockFetch({
      "/yaml/": () =>
        new Response(JSON.stringify({ error: "pods \"api-0\" is forbidden" }), { status: 502 }),
    });
    renderTable();
    pressDelete();
    fireEvent.click(await screen.findByRole("button", { name: /delete api-0/i }));

    expect(await screen.findByText(/forbidden/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete api-0/i })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
