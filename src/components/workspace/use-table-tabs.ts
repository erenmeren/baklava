"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * localStorage-backed workspace tab-strip state, shared by the postgres,
 * mysql, sqlserver and mongo strips. Everything tech-specific — the tab
 * union, its key/href/label, and how a path maps to a tab — stays with the
 * caller; this owns only the parts that were identical in all four copies.
 *
 * The `hydrated` flag is load-bearing twice over: the strip renders a blank
 * placeholder until it flips (so SSR and the first client render agree), and
 * the persist effect is gated on it (so the empty initial state never
 * overwrites what is in storage).
 */
export interface UseTableTabsOptions<T> {
  /** Full localStorage key, e.g. `baklava:pg-tabs:${connectionId}`. */
  storageKey: string;
  /**
   * The tab the current route maps to, or null if the route isn't a tab.
   * Must have a stable identity across re-renders whenever its value is
   * unchanged — every real call site provides this via `useMemo` (see e.g.
   * `postgres-tabs.tsx`'s `activeTab`). A fresh object every render defeats
   * the auto-add effect's `[activeTab, hydrated]` dependency, making it
   * re-fire on every render instead of only when the route actually changes.
   */
  activeTab: T | null;
  key: (tab: T) => string;
  href: (tab: T) => string;
  /** Where to go when the last tab is closed. */
  homeHref: string;
  /**
   * Adjust a tab as it is auto-added (used to number query tabs). Must not
   * mutate any field `key()` reads: the auto-add effect's "is this tab
   * already open?" guard compares the *raw*, pre-decoration `activeTab`'s
   * key against tabs already in the strip, so a decorator that changes a
   * keyed field makes the guard miss its own freshly-added tab.
   */
  onAdd?: (tab: T, existing: T[]) => T;
}

export interface UseTableTabsResult<T> {
  tabs: T[];
  setTabs: React.Dispatch<React.SetStateAction<T[]>>;
  hydrated: boolean;
  activeKey: string | null;
  closeTab: (key: string) => void;
}

function load<T>(storageKey: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(storageKey: string, tabs: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(tabs));
  } catch {
    // Quota or private-mode failures are not worth breaking navigation over.
  }
}

export function useTableTabs<T>({
  storageKey,
  activeTab,
  key,
  href,
  homeHref,
  onAdd,
}: UseTableTabsOptions<T>): UseTableTabsResult<T> {
  const router = useRouter();
  const [tabs, setTabs] = useState<T[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTabs(load<T>(storageKey));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) save(storageKey, tabs);
  }, [tabs, hydrated, storageKey]);

  // `key` / `href` / `onAdd` arrive as inline arrows at every call site, so
  // they have a fresh identity on every render. Putting them in a dep array
  // would re-run the auto-add effect and rebuild `closeTab` continuously;
  // suppressing exhaustive-deps instead would leave a stale-closure trap and
  // a lint suppression a reviewer would rightly flag. Hold the latest
  // callbacks in a ref and read them at call time — the standard
  // latest-callback pattern, and the effects then depend only on real data.
  //
  // The ref is synced from a plain `useEffect` (declared before the
  // auto-add effect below, so it flushes first within the same commit),
  // not by assigning `cbs.current` directly in the render body: these tab
  // strips render during real SSR, and `react-hooks/refs` (the React
  // Compiler-era lint rule) flags ref writes during render — reads/writes
  // inside an effect body are exempt. `useLayoutEffect` would also satisfy
  // the rule but additionally warns "does nothing on the server" for a
  // component that genuinely goes through SSR, which `useEffect` does not.
  const cbs = useRef({ key, href, onAdd });
  useEffect(() => {
    cbs.current = { key, href, onAdd };
  });

  const activeKey = activeTab ? key(activeTab) : null;

  useEffect(() => {
    if (!hydrated || !activeTab) return;
    const { key: keyOf, onAdd: decorate } = cbs.current;
    setTabs((prev) => {
      const k = keyOf(activeTab);
      if (prev.some((t) => keyOf(t) === k)) return prev;
      return [...prev, decorate ? decorate(activeTab, prev) : activeTab];
    });
  }, [activeTab, hydrated]);

  const closeTab = useCallback(
    (target: string) => {
      const { key: keyOf, href: hrefOf } = cbs.current;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => keyOf(t) === target);
        if (idx < 0) return prev;
        const next = prev.filter((_, i) => i !== idx);
        if (target === activeKey) {
          const fallback = next[idx - 1] ?? next[idx] ?? null;
          router.push(fallback ? hrefOf(fallback) : homeHref);
        }
        return next;
      });
    },
    [activeKey, router, homeHref],
  );

  return { tabs, setTabs, hydrated, activeKey, closeTab };
}
