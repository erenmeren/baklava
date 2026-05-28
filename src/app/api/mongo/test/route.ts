import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropMongoClient, probe } from "@/lib/connections/mongo";

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
  if (!body?.config?.uri?.trim()) {
    return NextResponse.json(
      { error: "Connection URI is required" },
      { status: 400 },
    );
  }
  if (
    !body.config.uri.startsWith("mongodb://") &&
    !body.config.uri.startsWith("mongodb+srv://")
  ) {
    return NextResponse.json(
      { error: "URI must begin with mongodb:// or mongodb+srv://" },
      { status: 400 },
    );
  }

  const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await probe(probeId, body.config);
    const record = body.save
      ? saveConnection({
          tech: "mongo",
          name: body.name || "MongoDB",
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
    dropMongoClient(probeId);
  }
}
