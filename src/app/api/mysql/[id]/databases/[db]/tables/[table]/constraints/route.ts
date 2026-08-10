import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listConstraints, listForeignKeys } from "@/lib/connections/mysql-constraints";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; db: string; table: string }>;
}

async function resolve(ctx: RouteContext) {
  const { id, db, table } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "mysql") {
    return {
      error: NextResponse.json({ error: "Connection not found" }, { status: 404 }),
    };
  }
  return {
    id,
    cfg: record.config as MysqlConfig,
    db: decodeURIComponent(db),
    table: decodeURIComponent(table),
  };
}

// RBAC: `/api/mysql/<id>/…` is covered by the proxy's generic tech-id branch
// in `connectionIdFromPath` (mysql is a known tech id), so no matcher entry
// is needed here — see AGENTS.md "Connection-access gate".
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  try {
    const [constraints, foreignKeys] = await Promise.all([
      listConstraints(r.cfg, r.db, r.table),
      listForeignKeys(r.cfg, r.db, r.table),
    ]);
    updateStatus(r.id, "ok");
    return NextResponse.json({ constraints, foreignKeys });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
