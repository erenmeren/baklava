import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  listUnderReplicated,
  listOngoingReassignments,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  try {
    const [underReplicated, reassignments] = await Promise.all([
      listUnderReplicated(record.config as KafkaConfig),
      listOngoingReassignments(record.config as KafkaConfig),
    ]);
    return NextResponse.json({ underReplicated, reassignments });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
