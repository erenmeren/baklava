import { NextRequest, NextResponse } from "next/server";
import { probeElastic } from "@/lib/connections/elastic";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { ElasticConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: ElasticConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.nodes?.length) {
    return NextResponse.json(
      { error: "At least one node URL is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeElastic(body.config);
    const record = body.save
      ? saveConnection({
          tech: "elastic",
          name: body.name || "Elasticsearch",
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
