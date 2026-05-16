import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { peekNatsMessages } from "@/lib/connections/nats";
import type { NatsConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, name } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "nats") {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  const url = new URL(req.url);
  const count = Math.min(
    Math.max(1, Math.floor(Number(url.searchParams.get("count")) || 10)),
    100
  );
  const fromSeqParam = url.searchParams.get("fromSeq");
  const fromSeq = fromSeqParam ? Math.max(0, Math.floor(Number(fromSeqParam))) : undefined;
  try {
    const messages = await peekNatsMessages(
      record.config as NatsConfig,
      decodeURIComponent(name),
      count,
      fromSeq
    );
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
