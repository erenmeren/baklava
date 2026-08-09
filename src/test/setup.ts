// Vitest global setup — runs once per worker before any test file.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Always isolate React render trees between tests.
afterEach(() => {
  cleanup();
});

// Force every test to use a deterministic, throwaway data dir so the real
// ~/.baklava/connections.json on the developer's machine is never touched.
// Each test file should still override this with its own tmpdir if it
// actually exercises persistence, but this is the belt-and-braces guard.
if (!process.env.BAKLAVA_DATA_DIR) {
  process.env.BAKLAVA_DATA_DIR = "/tmp/__baklava_test_safety__";
}

// Node 22+ defines an experimental global `localStorage` accessor gated
// behind `--localstorage-file`. That global already exists on `global`
// before vitest's happy-dom environment populates it for a "client" test
// file, and vitest only force-overrides an explicit allowlist of
// known-conflicting globals (`fetch`, `URL`, `Headers`, ...) — `localStorage`
// isn't on that list, so Node's own (inert without the flag) accessor wins
// over happy-dom's simulated Storage, and `window.localStorage` reads back
// `undefined`. Swap in a tiny in-memory Storage stand-in so `.dom.test.tsx`
// files can use `window.localStorage` the way a real browser test would.
// Only in the client (happy-dom) project — the server project has no
// `window` at all.
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const store = new Map<string, string>();
  const memoryStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  } as Storage;
  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}

// This polyfill (or happy-dom's own Storage, if a future vitest version
// stops shadowing it — see above) is shared module-level state across every
// `.dom.test.tsx` file: nothing tears it down between test files on its
// own, and nothing resets it between individual `it()` blocks within one
// file unless that file's own `beforeEach` remembers to. Clear it after
// every test so a write in one test can never leak into the next test's
// initial render — matching real browser test isolation, where each test
// would get a fresh tab/storage partition.
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});
