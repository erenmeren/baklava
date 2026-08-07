import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  dockerProvider,
  kafkaProvider,
  mongoProvider,
  qdrantProvider,
  blobProvider,
} from "./infra-providers";

/**
 * The provider cache is module-level and keyed by URL, so every test uses a
 * unique connection id. That keeps them order-independent without exposing a
 * test-only cache reset.
 */
let n = 0;
const nextId = () => `conn-${++n}`;

function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => routes[key] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ctx = (pathname = "/") => ({ pathname });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dockerProvider", () => {
  it("matches on name or image and links to the container detail page", async () => {
    const id = nextId();
    mockFetch({
      [`/api/docker/${id}/containers`]: {
        containers: [
          { id: "abc123", name: "api-gateway", image: "nginx:latest", state: "running" },
          { id: "def456", name: "worker", image: "redis:7", state: "exited" },
        ],
      },
    });

    const byName = await dockerProvider(id, "gate", ctx());
    expect(byName).toEqual([
      {
        label: "api-gateway",
        sublabel: "running · nginx:latest",
        href: `/docker/${id}/containers/abc123`,
        icon: "Container",
      },
    ]);

    const byImage = await dockerProvider(id, "redis", ctx());
    expect(byImage.map((o) => o.label)).toEqual(["worker"]);
  });

  it("returns nothing for an empty query without calling the daemon", async () => {
    const fetchFn = mockFetch({});
    expect(await dockerProvider(nextId(), "  ", ctx())).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("yields no results when the API fails", async () => {
    mockFetch({});
    expect(await dockerProvider(nextId(), "anything", ctx())).toEqual([]);
  });
});

describe("kafkaProvider", () => {
  it("returns topics and consumer groups together", async () => {
    const id = nextId();
    mockFetch({
      [`/api/kafka/${id}/topics`]: {
        topics: [{ name: "orders.v1", partitions: 6 }, { name: "audit", partitions: 1 }],
      },
      [`/api/kafka/${id}/consumer-groups`]: {
        groups: [{ groupId: "orders-consumer", state: "Stable" }],
      },
    });

    const out = await kafkaProvider(id, "orders", ctx());
    expect(out).toEqual([
      {
        label: "orders.v1",
        sublabel: "topic · 6 partitions",
        href: `/kafka/${id}/topics/orders.v1`,
        icon: "Layers",
      },
      {
        label: "orders-consumer",
        sublabel: "consumer group · Stable",
        href: `/kafka/${id}/consumer-groups/orders-consumer`,
        icon: "Users",
      },
    ]);
  });

  it("survives one of the two endpoints failing", async () => {
    const id = nextId();
    mockFetch({
      [`/api/kafka/${id}/topics`]: { topics: [{ name: "orders.v1", partitions: 6 }] },
    });
    const out = await kafkaProvider(id, "orders", ctx());
    expect(out.map((o) => o.label)).toEqual(["orders.v1"]);
  });
});

describe("mongoProvider", () => {
  it("lists databases when no database is in the path", async () => {
    const id = nextId();
    mockFetch({
      [`/api/mongo/${id}/databases`]: { databases: [{ name: "shop" }, { name: "logs" }] },
    });
    const out = await mongoProvider(id, "sho", ctx(`/mongo/${id}/databases`));
    expect(out).toEqual([
      { label: "shop", sublabel: "database", href: `/mongo/${id}/databases/shop`, icon: "Database" },
    ]);
  });

  it("adds the active database's collections, linked without a tables segment", async () => {
    const id = nextId();
    mockFetch({
      [`/api/mongo/${id}/databases/shop/collections`]: {
        collections: [{ name: "orders", type: "collection" }],
      },
      [`/api/mongo/${id}/databases`]: { databases: [{ name: "orders-archive" }] },
    });
    const out = await mongoProvider(id, "orders", ctx(`/mongo/${id}/databases/shop/orders`));
    expect(out[0]).toEqual({
      label: "orders",
      sublabel: "shop · collection",
      href: `/mongo/${id}/databases/shop/orders`,
      icon: "Table2",
    });
    expect(out[1].label).toBe("orders-archive");
  });

  it("decodes an encoded database name from the path", async () => {
    const id = nextId();
    mockFetch({
      [`/api/mongo/${id}/databases/my%20db/collections`]: {
        collections: [{ name: "events", type: "collection" }],
      },
      [`/api/mongo/${id}/databases`]: { databases: [] },
    });
    const out = await mongoProvider(id, "events", ctx(`/mongo/${id}/databases/my%20db`));
    expect(out[0].href).toBe(`/mongo/${id}/databases/my%20db/events`);
  });
});

describe("qdrantProvider", () => {
  it("links collections to their detail page", async () => {
    const id = nextId();
    mockFetch({
      [`/api/qdrant/${id}/collections`]: {
        collections: [{ name: "docs", status: "green", pointsCount: 42 }],
      },
    });
    expect(await qdrantProvider(id, "doc", ctx())).toEqual([
      {
        label: "docs",
        sublabel: "green · 42 points",
        href: `/qdrant/${id}/collections/docs`,
        icon: "Database",
      },
    ]);
  });
});

describe("blobProvider", () => {
  it.each(["s3", "r2", "minio"] as const)("routes %s buckets to their own workspace", async (tech) => {
    const id = nextId();
    mockFetch({ [`/api/${tech}/${id}/buckets`]: { buckets: [{ name: "assets" }] } });
    expect(await blobProvider(tech)(id, "ass", ctx())).toEqual([
      {
        label: "assets",
        sublabel: "bucket",
        href: `/${tech}/${id}/buckets/assets`,
        icon: "Boxes",
      },
    ]);
  });
});

describe("response caching", () => {
  it("serves repeat keystrokes from cache, then refetches after the TTL", async () => {
    const id = nextId();
    const fetchFn = mockFetch({
      [`/api/qdrant/${id}/collections`]: {
        collections: [{ name: "docs", status: "green", pointsCount: 1 }],
      },
    });

    await qdrantProvider(id, "d", ctx());
    await qdrantProvider(id, "do", ctx());
    await qdrantProvider(id, "doc", ctx());
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_001);
    await qdrantProvider(id, "docs", ctx());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
