import { NextRequest, NextResponse } from "next/server";
import { getConnection, updateStatus } from "@/lib/connections/store";
import { deleteElasticIndex, getElasticIndex } from "@/lib/connections/elastic";
import type { ElasticConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "elastic") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  try {
    const detail = await getElasticIndex(
      record.config as ElasticConfig,
      decodeURIComponent(name)
    );
    updateStatus(id, "ok");
    return NextResponse.json(detail);
  } catch (err) {
    const message = formatError(err);
    updateStatus(id, "error", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "elastic") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  try {
    await deleteElasticIndex(
      record.config as ElasticConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
