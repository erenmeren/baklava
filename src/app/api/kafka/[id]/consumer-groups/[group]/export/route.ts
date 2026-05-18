import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { describeConsumerGroup } from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; group: string }>;
}

/**
 * Returns the group's committed offsets as a downloadable JSON snapshot
 * suitable for re-importing later (or applying to a different group).
 *
 *   ?download=1 → returns Content-Disposition: attachment
 *   default     → returns JSON inline (useful for fetch + clipboard)
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id, group } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const detail = await describeConsumerGroup(
      record.config as KafkaConfig,
      decodeURIComponent(group),
    );
    const snapshot = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      groupId: detail.groupId,
      offsets: detail.offsets
        .filter((o) => o.offset !== "-1")
        .map((o) => ({
          topic: o.topic,
          partition: o.partition,
          offset: o.offset,
        })),
    };
    const body = JSON.stringify(snapshot, null, 2);
    const download = req.nextUrl.searchParams.get("download") === "1";
    const fname = `${detail.groupId.replace(/[^A-Za-z0-9._-]/g, "_")}_offsets.json`;
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        ...(download
          ? { "content-disposition": `attachment; filename="${fname}"` }
          : {}),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
