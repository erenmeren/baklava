import { NextRequest, NextResponse } from "next/server";
import { probeMongo } from "@/lib/connections/mongo";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: MongoConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cfg = body?.config;
  if (!cfg || (!cfg.uri && !cfg.host)) {
    return NextResponse.json(
      { error: "Either a URI or a host is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeMongo(cfg);
    const record = body.save
      ? saveConnection({
          tech: "mongo",
          name: body.name || "MongoDB",
          config: cfg,
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
