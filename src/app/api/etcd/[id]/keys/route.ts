import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { listEtcdKeys } from "@/lib/connections/etcd";
import type { EtcdConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "etcd") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const prefix = sp.get("prefix") ?? "";
  const limit = Number(sp.get("limit") ?? "100");

  try {
    const result = await listEtcdKeys(record.config as EtcdConfig, {
      prefix,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
    });
    updateStatus(id, "ok");
    return NextResponse.json(result);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
