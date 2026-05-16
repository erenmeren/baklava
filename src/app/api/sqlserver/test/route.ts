import { NextRequest, NextResponse } from "next/server";
import { probeSqlServer } from "@/lib/connections/sqlserver";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { SqlServerConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: SqlServerConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.host) {
    return NextResponse.json({ error: "Host is required" }, { status: 400 });
  }
  if (!body.config.user) {
    return NextResponse.json({ error: "User is required" }, { status: 400 });
  }

  try {
    const probe = await probeSqlServer(body.config);
    const record = body.save
      ? saveConnection({
          tech: "sqlserver",
          name: body.name || "SQL Server",
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
