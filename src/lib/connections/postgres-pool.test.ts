import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getPoolForTests,
  dropPostgresPools,
  withClient,
  _injectPoolForTests,
  _endAllPostgresPoolsForTests,
} from "./postgres";
import type { PostgresConfig } from "./types";

const cfg: PostgresConfig = {
  host: "db.example.com", port: 5432, database: "app", user: "u", password: "p", ssl: false,
} as PostgresConfig;

afterEach(async () => {
  await _endAllPostgresPoolsForTests();
});

describe("postgres pool cache", () => {
  it("reuses one pool per config+database, separate per database", async () => {
    const a1 = await getPoolForTests(cfg, "app");
    const a2 = await getPoolForTests(cfg, "app");
    const b = await getPoolForTests(cfg, "other");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("a different password yields a different pool", async () => {
    const p1 = await getPoolForTests(cfg, "app");
    const p2 = await getPoolForTests({ ...cfg, password: "different" }, "app");
    expect(p1).not.toBe(p2);
  });

  it("dropPostgresPools ends and evicts every pool for the connection identity", async () => {
    const a = await getPoolForTests(cfg, "app");
    const b = await getPoolForTests(cfg, "other");
    const endA = vi.spyOn(a, "end").mockResolvedValue();
    const endB = vi.spyOn(b, "end").mockResolvedValue();
    dropPostgresPools(cfg);
    expect(endA).toHaveBeenCalled();
    expect(endB).toHaveBeenCalled();
    const a2 = await getPoolForTests(cfg, "app");
    expect(a2).not.toBe(a);
  });

  it("withClient releases on success and destroys on error", async () => {
    const release = vi.fn();
    const fakeClient = { query: vi.fn(), release } as unknown;
    const fakePool = {
      connect: vi.fn(async () => fakeClient),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getPoolForTests>>;

    _injectPoolForTests(cfg, "app", fakePool);
    await withClient(cfg, "app", async () => "ok");
    expect(release).toHaveBeenCalledWith();

    release.mockClear();
    _injectPoolForTests(cfg, "app", fakePool);
    await expect(
      withClient(cfg, "app", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledWith(true);
  });

  it("resets session state with DISCARD ALL before reuse; destroys if reset fails", async () => {
    // Success: DISCARD ALL runs, then a clean release back to the pool.
    const release = vi.fn();
    const query = vi.fn(async () => ({}));
    const fakePool = {
      connect: vi.fn(async () => ({ query, release })),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getPoolForTests>>;
    _injectPoolForTests(cfg, "app", fakePool);
    await withClient(cfg, "app", async () => "ok");
    expect(query).toHaveBeenCalledWith("DISCARD ALL");
    expect(release).toHaveBeenCalledWith();

    // Reset fails (e.g. connection left in a transaction) → destroy it.
    const release2 = vi.fn();
    const query2 = vi.fn(async (q: string) => {
      if (q === "DISCARD ALL") throw new Error("DISCARD ALL cannot run inside a transaction block");
      return {};
    });
    const fakePool2 = {
      connect: vi.fn(async () => ({ query: query2, release: release2 })),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getPoolForTests>>;
    _injectPoolForTests(cfg, "app", fakePool2);
    await withClient(cfg, "app", async () => "ok");
    expect(release2).toHaveBeenCalledWith(true);
  });
});
