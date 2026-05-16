import { NextRequest, NextResponse } from "next/server";
import { probeRabbit } from "@/lib/connections/rabbit";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { RabbitConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: RabbitConfig;
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
      { error: "host is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeRabbit(body.config);
    const record = body.save
      ? saveConnection({
          tech: "rabbit",
          name: body.name || "RabbitMQ",
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
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 }
    );
  }
}
