import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { K8sShell } from "./k8s-shell";

const push = vi.fn();
const refresh = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => "/kubernetes/conn-1/pods",
  useSearchParams: () => search,
}));

function renderShell(defaultNamespace = "") {
  return render(
    <K8sShell
      connectionId="conn-1"
      namespaces={["billing", "payments"]}
      defaultNamespace={defaultNamespace}
      context="kind-kind"
      serverVersion="v1.31.0"
    >
      <div>rows</div>
    </K8sShell>,
  );
}

function openNamespaceMenu() {
  // The pill shows the current namespace and toggles the list.
  fireEvent.click(screen.getByRole("button", { name: /^ns/i }));
}

describe("K8sShell namespace selection", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    search = new URLSearchParams();
  });

  it("shows the namespace from the URL", () => {
    search = new URLSearchParams("ns=billing");
    renderShell("payments");
    expect(screen.getByRole("button", { name: /^ns billing/i })).toBeTruthy();
  });

  it("falls back to the connection's configured namespace", () => {
    renderShell("payments");
    expect(screen.getByRole("button", { name: /^ns payments/i })).toBeTruthy();
  });

  it("shows all-namespaces when nothing is configured", () => {
    renderShell("");
    expect(screen.getByRole("button", { name: /all-namespaces/i })).toBeTruthy();
  });

  it("navigates to ?ns= so the server re-lists in that namespace", () => {
    renderShell("");
    openNamespaceMenu();
    fireEvent.click(screen.getByRole("button", { name: "billing" }));

    expect(push).toHaveBeenCalledWith("/kubernetes/conn-1/pods?ns=billing");
  });

  it("navigates to ?ns=* when all-namespaces is chosen", () => {
    search = new URLSearchParams("ns=billing");
    renderShell("");
    openNamespaceMenu();
    fireEvent.click(
      screen.getAllByRole("button", { name: /all-namespaces/i }).at(-1)!,
    );

    expect(push).toHaveBeenCalledWith("/kubernetes/conn-1/pods?ns=*");
  });
});

describe("K8sShell auto-refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockClear();
    refresh.mockClear();
    search = new URLSearchParams();
  });
  afterEach(() => vi.useRealTimers());

  it("refreshes the server-rendered rows on an interval", () => {
    renderShell("");
    expect(refresh).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(5_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(5_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops refreshing once auto-refresh is toggled off", () => {
    renderShell("");
    fireEvent.click(screen.getByRole("button", { name: /auto-refresh/i }));

    act(() => void vi.advanceTimersByTime(20_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips the refresh while the tab is hidden", () => {
    const spy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    renderShell("");

    act(() => void vi.advanceTimersByTime(15_000));
    expect(refresh).not.toHaveBeenCalled();

    spy.mockReturnValue(false);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
