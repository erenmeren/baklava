import { NextRequest, NextResponse } from "next/server";
import { probeWeaviate } from "@/lib/connections/weaviate";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { WeaviateConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: WeaviateConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const probe = await probeWeaviate(body.config);
    const record = body.save
      ? saveConnection({
          tech: "weaviate",
          name: body.name || "Weaviate",
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
