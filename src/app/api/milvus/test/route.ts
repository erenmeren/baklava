import { NextRequest, NextResponse } from "next/server";
import { probeMilvus } from "@/lib/connections/milvus";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { MilvusConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: MilvusConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.address) {
    return NextResponse.json(
      { error: "Address is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeMilvus(body.config);
    const record = body.save
      ? saveConnection({
          tech: "milvus",
          name: body.name || "Milvus",
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
