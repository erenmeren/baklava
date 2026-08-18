import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditOverlay } from "./edit-overlay";

// The applied manifest has to reach the screen: the rows behind this overlay
// come from a server component, so only `router.refresh()` re-renders them.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

/**
 * The overlay GETs the manifest and PUTs it back to the same URL, so the
 * stub has to switch on the method rather than the path.
 */
function stubYamlEndpoint(put: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") return put();
    return new Response(JSON.stringify({ yaml: "kind: Deployment\nreplicas: 2\n" }), {
      status: 200,
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function editAndSave() {
  const ta = await screen.findByRole("textbox");
  fireEvent.change(ta, { target: { value: "kind: Deployment\nreplicas: 3\n" } });
  fireEvent.click(screen.getByRole("button", { name: "save" }));
}

function renderOverlay() {
  render(
    <EditOverlay
      connectionId="conn-1"
      kind="deployment"
      namespace="payments"
      name="api"
      onClose={vi.fn()}
    />,
  );
}

describe("EditOverlay apply", () => {
  let restore: () => void;
  beforeEach(() => refresh.mockClear());
  afterEach(() => restore());

  it("refreshes the route after a successful apply", async () => {
    restore = stubYamlEndpoint(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderOverlay();

    await editAndSave();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not refresh when the apply fails", async () => {
    restore = stubYamlEndpoint(
      () =>
        new Response(JSON.stringify({ error: "admission webhook denied" }), { status: 502 }),
    );
    renderOverlay();

    await editAndSave();

    expect(await screen.findByText(/admission webhook denied/i)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
