import { NextRequest, NextResponse } from "next/server";
import { probeKafka } from "@/lib/connections/kafka";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { KafkaConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: KafkaConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.brokers?.length) {
    return NextResponse.json(
      { error: "At least one broker is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeKafka(body.config);
    const record = body.save
      ? saveConnection({
          tech: "kafka",
          name: body.name || "Kafka",
          config: body.config,
          status: "ok",
          ownerId: getCurrentUser(req)?.id,
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
