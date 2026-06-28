import { NextRequest, NextResponse } from "next/server";
import { probeMysql } from "@/lib/connections/mysql";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { MysqlConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: MysqlConfig;
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
    return NextResponse.json({ error: "host is required" }, { status: 400 });
  }

  try {
    const probe = await probeMysql(body.config);
    const record = body.save
      ? saveConnection({
          tech: "mysql",
          name: body.name || "MySQL",
          config: body.config,
          status: "ok",
          ownerId: getCurrentUser(req)?.id,
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
