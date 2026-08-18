import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RestartDialog, ScaleDialog } from "./deployment-actions";
import type { DeploymentRow } from "@/lib/kubernetes/row-types";

const ROW: DeploymentRow = {
  namespace: "payments",
  name: "api",
  ready: "2/2",
  upToDate: 2,
  available: 2,
  image: "ghcr.io/acme/api:1.4.0",
  selector: "app=api",
  ageSeconds: 3600,
};

function stubEndpoint(reply: () => Response) {
  const original = globalThis.fetch;
  const calls: [string, RequestInit | undefined][] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init]);
    return reply();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const denied = () =>
  new Response(JSON.stringify({ error: "deployments.apps \"api\" is forbidden" }), {
    status: 502,
  });

describe("ScaleDialog", () => {
  let stub: ReturnType<typeof stubEndpoint>;
  afterEach(() => stub.restore());

  function renderDialog(close = vi.fn(), refresh = vi.fn()) {
    render(
      <ScaleDialog connectionId="conn-1" row={ROW} close={close} refresh={refresh} />,
    );
    return { close, refresh };
  }

  beforeEach(() => {
    stub = stubEndpoint(ok);
  });

  it("starts from the deployment's current replica count", () => {
    renderDialog();
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
  });

  it("posts the new replica count", async () => {
    renderDialog();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /scale/i }));

    await waitFor(() => expect(stub.calls.length).toBe(1));
    const [url, init] = stub.calls[0];
    expect(url).toBe("/api/kubernetes/conn-1/deployments/payments/api");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ action: "scale", replicas: 5 });
  });

  it("allows scaling to zero", async () => {
    renderDialog();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /scale/i }));

    await waitFor(() => expect(stub.calls.length).toBe(1));
    expect(JSON.parse(String(stub.calls[0][1]?.body))).toEqual({
      action: "scale",
      replicas: 0,
    });
  });

  it("refreshes and closes once the cluster accepts it", async () => {
    const { close, refresh } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /scale/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(close).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the cluster's refusal", async () => {
    stub.restore();
    stub = stubEndpoint(denied);
    const { close, refresh } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /scale/i }));

    expect(await screen.findByText(/forbidden/i)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("RestartDialog", () => {
  let stub: ReturnType<typeof stubEndpoint>;
  beforeEach(() => {
    stub = stubEndpoint(ok);
  });
  afterEach(() => stub.restore());

  it("names the deployment it is about to roll", () => {
    render(
      <RestartDialog connectionId="conn-1" row={ROW} close={vi.fn()} refresh={vi.fn()} />,
    );
    expect(screen.getByText(/payments\/api/)).toBeTruthy();
  });

  it("posts the restart action and refreshes", async () => {
    const refresh = vi.fn();
    render(
      <RestartDialog connectionId="conn-1" row={ROW} close={vi.fn()} refresh={refresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /restart api/i }));

    await waitFor(() => expect(stub.calls.length).toBe(1));
    expect(JSON.parse(String(stub.calls[0][1]?.body))).toEqual({ action: "restart" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("surfaces a refusal instead of closing", async () => {
    stub.restore();
    stub = stubEndpoint(denied);
    const close = vi.fn();
    render(
      <RestartDialog connectionId="conn-1" row={ROW} close={close} refresh={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /restart api/i }));

    expect(await screen.findByText(/forbidden/i)).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });
});
