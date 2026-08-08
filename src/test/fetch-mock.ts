import { vi } from "vitest";

export type RouteMap = Record<string, unknown | ((url: string) => unknown)>;

/**
 * Install a `fetch` stub that matches request URLs against declared
 * patterns.
 *
 * Matching rules:
 *   - A plain pattern (e.g. `"/rows"` or `"view=ddl"`) matches anywhere in
 *     the URL — including inside an unrelated path segment (`"/data"`
 *     inside `"/databases"`) or a query string. This is the common case.
 *   - A pattern ending in `"$"` anchors to the end of the URL's *path*
 *     (everything before `"?"`): `"/tables/users$"` matches
 *     `".../tables/users"` but not `".../tables/users/rows"`. Use this to
 *     distinguish a resource's own GET from a GET on one of its
 *     sub-resources — plain substring matching can't do this on its own,
 *     because the sub-resource's URL always contains the resource's URL as
 *     a literal prefix, so any pattern that matches the resource also
 *     matches the sub-resource.
 *
 * Every declared pattern is checked against every request, and if more
 * than one matches, `mockFetch` throws immediately instead of silently
 * serving whichever pattern happened to be declared first. A route map
 * where two patterns both match the same URL is not a matter of "the more
 * specific one should win" in general — plain substrings have no reliable
 * notion of specificity (a shorter, unrelated pattern can accidentally
 * match while a longer, semantically-correct one doesn't), so silently
 * picking one is just as likely to serve the wrong fixture as the
 * first-declared rule this replaced. Narrow your patterns instead — most
 * often with a trailing `"$"` anchor on the base resource, or by folding in
 * the `"?"` that starts a sub-resource's own query string — until exactly
 * one matches.
 *
 * Returns a restore function; call it in afterEach.
 */
export function mockFetch(routes: RouteMap): () => void {
  const original = globalThis.fetch;
  const entries = Object.entries(routes);
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.split("?")[0];
    const matches = entries.filter(([pattern]) =>
      pattern.endsWith("$") ? path.endsWith(pattern.slice(0, -1)) : url.includes(pattern)
    );
    if (matches.length > 1) {
      throw new Error(
        `mockFetch: ambiguous match for ${url} — patterns ${matches
          .map(([pattern]) => JSON.stringify(pattern))
          .join(", ")} all match. Narrow the patterns (e.g. a trailing "$" anchor, or include the "?" that starts a sub-resource's query string) so exactly one matches.`
      );
    }
    if (matches.length === 0) {
      throw new Error(`mockFetch: no route matched ${url}`);
    }
    const [, payload] = matches[0];
    const body = typeof payload === "function" ? (payload as (u: string) => unknown)(url) : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
