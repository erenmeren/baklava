import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { listAllRelations } from "@/lib/connections/postgres";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string }>;
}

/**
 * Flat list of every table/view/matview in this DB with column names.
 * Powers the Cmd+K command palette. Cached per (connection, db) for
 * 60s in a globalThis slot to keep keystrokes snappy.
 */

interface CacheEntry {
  at: number;
  payload: unknown;
}
const TTL_MS = 60_000;
const GLOBAL_KEY = Symbol.for("baklava.pg.allRelations");

interface Bag {
  cache: Map<string, CacheEntry>;
}
function bag(): Bag {
  const g = globalThis as unknown as Record<symbol, Bag>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { cache: new Map() };
  return g[GLOBAL_KEY];
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, db } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "postgres") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const key = `${id}::${db}`;
  const cached = bag().cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.payload);
  }
  try {
    const relations = await listAllRelations(
      record.config as PostgresConfig,
      decodeURIComponent(db),
    );
    const payload = { relations };
    bag().cache.set(key, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
