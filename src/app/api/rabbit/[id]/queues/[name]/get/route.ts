import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { peekRabbitMessages } from "@/lib/connections/rabbit";
import type { RabbitConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "rabbit") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  let body: { count?: number; requeue?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }
  const count = Math.min(
    Math.max(1, Math.floor(Number(body.count) || 10)),
    100
  );
  const requeue = body.requeue !== false;
  try {
    const messages = await peekRabbitMessages(
      record.config as RabbitConfig,
      decodeURIComponent(name),
      count,
      requeue
    );
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
