import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropRedisClient, probe } from "@/lib/connections/redis";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: RedisConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.mode) {
    return NextResponse.json(
      { error: "Connection mode is required" },
      { status: 400 },
    );
  }
  if (body.config.mode === "single" && !body.config.host?.trim()) {
    return NextResponse.json({ error: "Host is required" }, { status: 400 });
  }
  if (body.config.mode === "cluster" && !body.config.nodes?.trim()) {
    return NextResponse.json(
      { error: "At least one cluster seed node is required" },
      { status: 400 },
    );
  }

  const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await probe(probeId, body.config);
    const record = body.save
      ? saveConnection({
          tech: "redis",
          name: body.name || "Redis",
          config: body.config,
          status: "ok",
        })
      : null;
    return NextResponse.json({
      ok: true,
      probe: result,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 },
    );
  } finally {
    dropRedisClient(probeId);
  }
}
