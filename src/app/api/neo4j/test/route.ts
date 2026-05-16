import { NextRequest, NextResponse } from "next/server";
import { probeNeo4j } from "@/lib/connections/neo4j";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { Neo4jConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: Neo4jConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.uri || !body.config.user) {
    return NextResponse.json(
      { error: "URI and user are required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probeNeo4j(body.config);
    const record = body.save
      ? saveConnection({
          tech: "neo4j",
          name: body.name || "Neo4j",
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
