import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApplyOverlay } from "./apply-overlay";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

type Body = { yaml: string; namespace?: string; dryRun: boolean; force: boolean };

function stub(respond: (b: Body) => unknown) {
  const calls: Body[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body)) as Body;
    calls.push(b);
    return new Response(JSON.stringify(respond(b)), { status: 200 });
  }) as typeof fetch;
  restore = () => (globalThis.fetch = original);
  return calls;
}
let restore = () => {};
afterEach(() => {
  restore();
  refresh.mockClear();
});

const created = {
  results: [
    { apiVersion: "v1", kind: "ConfigMap", name: "example", namespace: "demo", action: "created", diff: "@@ -0,0 +1,1 @@\n+kind: ConfigMap" },
  ],
};

describe("ApplyOverlay", () => {
  it("previews as a dry run in the current namespace, then applies for real", async () => {
    const calls = stub(() => created);
    render(<ApplyOverlay connectionId="c1" namespace="demo" onClose={vi.fn()} />);
    const apply = screen.getByRole("button", { name: "apply" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    await screen.findByText("+kind: ConfigMap");
    expect(calls[0]).toMatchObject({ namespace: "demo", dryRun: true, force: false });
    expect(screen.getByText("created")).toBeTruthy();

    await waitFor(() => expect(apply.disabled).toBe(false));
    fireEvent.click(apply);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls[1]).toMatchObject({ dryRun: false, force: false });
  });

  it("offers force apply for conflicts, behind the confirm overlay", async () => {
    const calls = stub((b) =>
      b.force
        ? created
        : {
            results: [
              {
                apiVersion: "v1",
                kind: "ConfigMap",
                name: "example",
                action: "conflict",
                conflicts: [{ field: ".data.key", message: 'conflict with "kubectl"' }],
              },
            ],
          },
    );
    render(<ApplyOverlay connectionId="c1" namespace="*" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    expect(await screen.findByText(".data.key")).toBeTruthy();
    expect(calls[0].namespace).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "force apply…" }));
    fireEvent.click(screen.getByRole("button", { name: "force apply" }));
    await waitFor(() => expect(calls[1]).toMatchObject({ dryRun: false, force: true }));
  });
});
