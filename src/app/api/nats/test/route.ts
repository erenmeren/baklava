import { NextRequest, NextResponse } from "next/server";
import { probeNats } from "@/lib/connections/nats";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { NatsConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: NatsConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.servers?.length) {
    return NextResponse.json(
      { error: "At least one server is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeNats(body.config);
    const record = body.save
      ? saveConnection({
          tech: "nats",
          name: body.name || "NATS",
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
