import { NextRequest, NextResponse } from "next/server";
import { probeRedis } from "@/lib/connections/redis";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { RedisConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

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
  if (!body?.config?.host) {
    return NextResponse.json(
      { error: "Host is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeRedis(body.config);
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
      probe,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
