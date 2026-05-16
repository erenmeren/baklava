import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { searchElasticIndex } from "@/lib/connections/elastic";
import type { ElasticConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "elastic") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    size?: number;
  };
  try {
    const result = await searchElasticIndex(
      record.config as ElasticConfig,
      decodeURIComponent(name),
      body.query ?? "",
      Number(body.size ?? 10)
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
