import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { bulkDeleteConsumerGroups } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  groupIds?: string[];
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const ids = (body.groupIds ?? []).filter(
    (s) => typeof s === "string" && s.length > 0,
  );
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "groupIds array is required" },
      { status: 400 },
    );
  }
  try {
    const result = await bulkDeleteConsumerGroups(
      record.config as KafkaConfig,
      ids,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
