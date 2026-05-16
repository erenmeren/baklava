import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { getRabbitQueueBindings } from "@/lib/connections/rabbit";
import type { RabbitConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "rabbit") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  try {
    const bindings = await getRabbitQueueBindings(
      record.config as RabbitConfig,
      decodeURIComponent(name)
    );
    return NextResponse.json({ bindings });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
