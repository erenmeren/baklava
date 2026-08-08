import { vi } from "vitest";

export type RouteMap = Record<string, unknown | ((url: string) => unknown)>;

/**
 * Install a `fetch` stub that matches request URLs against substrings.
 *
 * Routes are tested in declaration order, so put the most specific first.
 * An unmatched URL rejects loudly rather than hanging the component in a
 * permanent loading state — a silent 404 makes these tests very hard to debug.
 *
 * Returns a restore function; call it in afterEach.
 */
export function mockFetch(routes: RouteMap): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, payload] of Object.entries(routes)) {
      if (!url.includes(pattern)) continue;
      const body = typeof payload === "function" ? (payload as (u: string) => unknown)(url) : payload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`mockFetch: no route matched ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
