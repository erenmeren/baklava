import { NextRequest, NextResponse } from "next/server";
import { probePostgres } from "@/lib/connections/postgres";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { PostgresConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: PostgresConfig;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.config?.host || !body.config.database) {
    return NextResponse.json(
      { error: "host and database are required" },
      { status: 400 }
    );
  }

  try {
    const probe = await probePostgres(body.config);
    const record = body.save
      ? saveConnection({
          tech: "postgres",
          name: body.name || "Postgres",
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
