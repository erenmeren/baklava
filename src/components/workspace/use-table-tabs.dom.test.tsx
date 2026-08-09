import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTableTabs } from "./use-table-tabs";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type Tab = { kind: "table"; name: string };
const key = (t: Tab) => `t:${t.name}`;
const href = (t: Tab) => `/pg/c1/tables/${t.name}`;

const STORAGE_KEY = "baklava:test-tabs:c1";

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
});

function setup(activeTab: Tab | null) {
  return renderHook(() =>
    useTableTabs<Tab>({
      storageKey: STORAGE_KEY,
      activeTab,
      key,
      href,
      homeHref: "/pg/c1",
    }),
  );
}

describe("useTableTabs", () => {
  it("hydrates from localStorage and reports hydrated", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ kind: "table", name: "users" }]),
    );
    const { result } = setup(null);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.tabs).toEqual([{ kind: "table", name: "users" }]);
  });

  it("starts empty when the stored value is corrupt rather than throwing", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = setup(null);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.tabs).toEqual([]);
  });

  it("auto-adds the active tab and persists it", async () => {
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() =>
      expect(result.current.tabs).toEqual([{ kind: "table", name: "orders" }]),
    );
    expect(result.current.activeKey).toBe("t:orders");
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
        { kind: "table", name: "orders" },
      ]),
    );
  });

  it("does not add the active tab twice", async () => {
    const { result, rerender } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    rerender();
    expect(result.current.tabs).toHaveLength(1);
  });

  it("closing the active tab navigates to the previous one", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { kind: "table", name: "users" },
        { kind: "table", name: "orders" },
      ]),
    );
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    act(() => result.current.closeTab("t:orders"));
    expect(result.current.tabs).toEqual([{ kind: "table", name: "users" }]);
    expect(push).toHaveBeenCalledWith("/pg/c1/tables/users");
  });

  it("closing the last tab navigates home", async () => {
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    act(() => result.current.closeTab("t:orders"));
    expect(push).toHaveBeenCalledWith("/pg/c1");
  });

  it("closing a background tab does not navigate", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { kind: "table", name: "users" },
        { kind: "table", name: "orders" },
      ]),
    );
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    act(() => result.current.closeTab("t:users"));
    expect(push).not.toHaveBeenCalled();
    expect(result.current.tabs).toEqual([{ kind: "table", name: "orders" }]);
  });

  it("passes new tabs through onAdd so callers can number them", async () => {
    // activeTab must have a stable identity across re-renders, exactly as
    // every real call site provides via useMemo (e.g. postgres-tabs.tsx) —
    // constructing it fresh inside the renderHook callback would make the
    // auto-add effect's [activeTab, hydrated] dependency change on every
    // render and re-fire forever.
    const activeTab: Tab = { kind: "table", name: "" };
    const { result } = renderHook(() =>
      useTableTabs<Tab>({
        storageKey: STORAGE_KEY,
        activeTab,
        key: (t) => `t:${t.name}`,
        href,
        homeHref: "/pg/c1",
        onAdd: (tab, existing) => ({ ...tab, name: `query ${existing.length + 1}` }),
      }),
    );
    await waitFor(() =>
      expect(result.current.tabs).toEqual([{ kind: "table", name: "query 1" }]),
    );
  });
});
