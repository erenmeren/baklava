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

  it("never writes an empty array to storage before hydration completes", async () => {
    // The persist effect's `if (hydrated) save(...)` guard exists because,
    // without it, the effect still fires on the very first commit — with
    // the pre-hydrate `tabs` state ([]) — and would clobber whatever was
    // already in storage before the hydrate effect's loaded value has had a
    // chance to land. That bad write then gets silently self-corrected on
    // the NEXT commit (tabs/hydrated changing re-fires the same effect with
    // the real value), so asserting only on the settled end state — what
    // every other test in this file does — can never catch a missing guard:
    // by the time `waitFor` resolves, the correction has already happened.
    // Spying on every `setItem` call and inspecting the first one is the
    // only way to see the transient bad write.
    const seeded = [{ kind: "table" as const, name: "users" }];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const { result } = setup(null);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    const callsForKey = setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY);
    expect(callsForKey.length).toBeGreaterThan(0);
    expect(JSON.parse(callsForKey[0][1] as string)).toEqual(seeded);
    setItemSpy.mockRestore();
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

  it("does not duplicate a tab when activeTab is re-supplied as a new object with the same value", async () => {
    // setup()'s activeTab is captured once by closure, so a plain rerender()
    // (as in the test above) reuses the same reference and never re-runs the
    // auto-add effect at all — that only proves the effect's dependency
    // array is correct, not that the internal "already open?" guard works.
    // Real re-navigation to an already-open tab produces exactly this case:
    // tabFromPath returns a brand-new object every call, and only useMemo's
    // dependency equality (on pathname/connectionId, not on the returned
    // Tab's structural value) prevents identity churn — navigating to the
    // SAME tab twice still yields two different Tab object references with
    // identical field values. Passing new props here forces the auto-add
    // effect to genuinely re-run, so this exercises the dedup check itself.
    const { result, rerender } = renderHook(
      (props: { activeTab: Tab }) =>
        useTableTabs<Tab>({
          storageKey: STORAGE_KEY,
          activeTab: props.activeTab,
          key,
          href,
          homeHref: "/pg/c1",
        }),
      { initialProps: { activeTab: { kind: "table", name: "orders" } } },
    );
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    rerender({ activeTab: { kind: "table", name: "orders" } });
    await waitFor(() =>
      expect(result.current.tabs).toEqual([{ kind: "table", name: "orders" }]),
    );
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
