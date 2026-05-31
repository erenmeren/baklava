import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropR2Client, probe } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: R2Config;
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
  if (!cfg?.accountId?.trim()) {
    return NextResponse.json({ error: "Account ID is required" }, { status: 400 });
  }
  if (!cfg?.accessKeyId?.trim() || !cfg?.secretAccessKey) {
    return NextResponse.json(
      { error: "Access Key ID and Secret Access Key are required" },
      { status: 400 },
    );
  }

  const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await probe(probeId, cfg);
    const record = body.save
      ? saveConnection({
          tech: "r2",
          name: body.name || "Cloudflare R2",
          config: cfg,
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
    dropR2Client(probeId);
  }
}
