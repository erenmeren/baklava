import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { K8sContextProvider, type K8sContextValue } from "./k8s-context";
import { ResourceTable, type Column } from "./resource-table";

// ResourceTable calls `router.refresh()` after a mutation so the server
// components that rendered the rows re-run. No App Router is mounted here.
const refresh = vi.fn();
let selectParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(selectParam ? `select=${selectParam}` : ""),
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

describe("ResourceTable custom row actions", () => {
  let restore: () => void;
  beforeEach(() => {
    refresh.mockClear();
    restore = mockFetch({ "/yaml/": { ok: true } });
  });
  afterEach(() => restore());

  function renderWithAction() {
    const seen: Row[] = [];
    render(
      <K8sContextProvider value={CTX}>
        <ResourceTable
          resource="Deployments"
          kind="deployment"
          rows={ROWS}
          columns={COLUMNS}
          actions={{ delete: true }}
          rowActions={[
            {
              key: "S",
              label: "scale",
              render: ({ row, close, refresh: doRefresh }) => {
                seen.push(row);
                return (
                  <div>
                    <span>scaling {row.name}</span>
                    <button onClick={doRefresh}>apply</button>
                    <button onClick={close}>dismiss</button>
                  </div>
                );
              },
            },
          ]}
        />
      </K8sContextProvider>,
    );
    return seen;
  }

  it("opens the action for the selected row on its key", () => {
    const seen = renderWithAction();
    fireEvent.keyDown(window, { key: "S" });

    expect(screen.getByText("scaling api-0")).toBeTruthy();
    expect(seen).toEqual([ROWS[0]]);
  });

  it("advertises the action in the hotkey hints", () => {
    renderWithAction();
    expect(screen.getByText("scale")).toBeTruthy();
  });

  it("swallows navigation keys while the action is open", () => {
    renderWithAction();
    fireEvent.keyDown(window, { key: "S" });
    fireEvent.keyDown(window, { key: "j" });

    // Still the first row — j must not move the selection behind the dialog.
    expect(screen.getByText("scaling api-0")).toBeTruthy();
  });

  it("closes through the handed-in close callback", () => {
    renderWithAction();
    fireEvent.keyDown(window, { key: "S" });
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));

    expect(screen.queryByText("scaling api-0")).toBeNull();
  });

  it("hands the action a refresh it can call after mutating", () => {
    renderWithAction();
    fireEvent.keyDown(window, { key: "S" });
    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    expect(refresh).toHaveBeenCalled();
  });

  it("does not fire the action key while another overlay is open", () => {
    renderWithAction();
    fireEvent.keyDown(window, { key: "D" }); // delete confirmation
    fireEvent.keyDown(window, { key: "S" });

    expect(screen.queryByText("scaling api-0")).toBeNull();
  });
});

describe("ResourceTable deep link", () => {
  let restore: () => void;
  beforeEach(() => {
    selectParam = null;
    restore = mockFetch({ "/yaml/": { ok: true } });
  });
  afterEach(() => restore());

  it("selects the row named by ?select= so the palette can land on it", () => {
    selectParam = "api-1";
    renderTable();

    expect(screen.getByRole("row", { name: /api-1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("row", { name: /api-0/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("falls back to the first row when ?select= names nothing here", () => {
    selectParam = "ghost";
    renderTable();

    expect(screen.getByRole("row", { name: /api-0/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("selects the first row when there is no ?select=", () => {
    renderTable();
    expect(screen.getByRole("row", { name: /api-0/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("ResourceTable describe", () => {
  let restore: () => void;
  afterEach(() => restore());

  it("fetches the live describe for the selected row", async () => {
    restore = mockFetch({ "/describe/": { text: "Name:         api-0\nEvents:       <none>" } });
    renderTable();
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url] = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(url).toBe("/api/kubernetes/conn-1/describe/pod/api-0?namespace=payments");
    expect(await screen.findByText(/Events:/)).toBeTruthy();
  });

  it("falls back to the row's own fields when the cluster describe fails", async () => {
    restore = mockFetch({
      "/describe/": () => new Response(JSON.stringify({ error: "forbidden" }), { status: 502 }),
    });
    renderTable();
    fireEvent.keyDown(window, { key: "Enter" });

    // Never worse than the old local dump: the overlay still describes the row
    // in its "key           : value" shape, which the table itself never renders.
    expect(await screen.findByText(/name\s+: api-0/)).toBeTruthy();
  });
});
