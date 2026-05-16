import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getNatsConsumers } from "@/lib/connections/nats";
import type { NatsConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "nats") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  try {
    const consumers = await getNatsConsumers(
      record.config as NatsConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ consumers });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
