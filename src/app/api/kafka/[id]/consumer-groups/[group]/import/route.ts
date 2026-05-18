import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import {
  getConsumerGroupState,
  importGroupOffsets,
  type OffsetSnapshotEntry,
} from "@/lib/connections/kafka";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; group: string }>;
}

interface ImportBody {
  /** Either a flat array, or a {version, offsets} export envelope. */
  offsets?: OffsetSnapshotEntry[];
  version?: number;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, group } = await ctx.params;
  const record = getConnection(id);
  if (!record || record.tech !== "kafka") {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  let body: ImportBody | OffsetSnapshotEntry[];
  try {
    body = (await req.json()) as ImportBody | OffsetSnapshotEntry[];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const snapshot: OffsetSnapshotEntry[] = Array.isArray(body)
    ? body
    : (body.offsets ?? []);
  if (snapshot.length === 0) {
    return NextResponse.json(
      { error: "Snapshot is empty — expected an offsets array" },
      { status: 400 },
    );
  }
  const groupId = decodeURIComponent(group);
  try {
    const state = await getConsumerGroupState(
      record.config as KafkaConfig,
      groupId,
    );
    if (state && state !== "Empty") {
      return NextResponse.json(
        {
          error: `Group is ${state}, not Empty`,
          hint: "Stop all consumers in this group, then try again.",
        },
        { status: 409 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
  try {
    const result = await importGroupOffsets(
      record.config as KafkaConfig,
      groupId,
      snapshot,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 502 });
  }
}
