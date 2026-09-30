import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { QdrantConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { probeQdrant } from "@/lib/connections/qdrant";
import { getCurrentUser } from "@/lib/auth/current-user";
import { egressRejection } from "@/lib/net/connection-targets";

export const runtime = "nodejs";

interface TestRequest { name: string; config: QdrantConfig; save?: boolean }

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try { body = (await req.json()) as TestRequest; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const url = body?.config?.url?.trim();
  if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });
  body.config = { ...body.config, url };
  const egress = await egressRejection("qdrant", body.config);
  if (egress) return egress;
  try {
    const probe = await probeQdrant(body.config);
    const record = body.save
      ? saveConnection({ tech: "qdrant", name: body.name || "Qdrant", config: body.config, status: "ok", ownerId: getCurrentUser(req)?.id })
      : null;
    return NextResponse.json({ ok: true, probe, connection: record ? publicView(record) : null });
  } catch (err) {
    return NextResponse.json({ ok: false, error: formatError(err) }, { status: 200 });
  }
}
