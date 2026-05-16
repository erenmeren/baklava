import { NextRequest, NextResponse } from "next/server";
import { probeEtcd } from "@/lib/connections/etcd";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { EtcdConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: EtcdConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.hosts?.length) {
    return NextResponse.json(
      { error: "At least one host is required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeEtcd(body.config);
    const record = body.save
      ? saveConnection({
          tech: "etcd",
          name: body.name || "etcd",
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
    const message = formatError(err);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
