import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { MongoConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropMongoClient, probe } from "@/lib/connections/mongo";
import { getCurrentUser } from "@/lib/auth/current-user";

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
  // Trim + strip wrapping quotes the user may have pasted accidentally.
  const rawUri = body?.config?.uri ?? "";
  const cleaned = rawUri.trim().replace(/^['"`](.*)['"`]$/, "$1").trim();
  if (!cleaned) {
    return NextResponse.json(
      { error: "Connection URI is required" },
      { status: 400 },
    );
  }
  const lower = cleaned.toLowerCase();
  if (!lower.startsWith("mongodb://") && !lower.startsWith("mongodb+srv://")) {
    const preview = cleaned.slice(0, 30) + (cleaned.length > 30 ? "…" : "");
    return NextResponse.json(
      {
        error: `URI must begin with mongodb:// or mongodb+srv://. Got: "${preview}"`,
      },
      { status: 400 },
    );
  }
  // Use the cleaned value going forward.
  body.config = { ...body.config, uri: cleaned };

  const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await probe(probeId, body.config);
    const record = body.save
      ? saveConnection({
          tech: "mongo",
          name: body.name || "MongoDB",
          config: body.config,
          status: "ok",
          ownerId: getCurrentUser(req)?.id,
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
